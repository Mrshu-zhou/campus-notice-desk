import type { Task, TaskPatch } from "../types";

export interface TaskRelation {
  task: Task;
  score: number;
  kind: "duplicate" | "update";
  changed: string[];
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。；：、！？,.!?;:()（）「」“”"'《》【】[\]-]/g, "");
}

function bigrams(value: string) {
  const text = normalize(value);
  if (text.length <= 2) return new Set(text ? [text] : []);
  const grams = new Set<string>();
  for (let index = 0; index < text.length - 1; index += 1) grams.add(text.slice(index, index + 2));
  return grams;
}

function similarity(left: string, right: string) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((gram) => { if (b.has(gram)) overlap += 1; });
  return (2 * overlap) / (a.size + b.size);
}

function containsTitle(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

function materialOverlap(left: string[], right: string[]) {
  const a = new Set(left.map(normalize).filter((item) => item.length >= 2));
  const b = new Set(right.map(normalize).filter((item) => item.length >= 2));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((item) => { if (b.has(item)) overlap += 1; });
  return overlap / Math.min(a.size, b.size);
}

function changedFields(existing: Task, incoming: Task) {
  const changed: string[] = [];
  if (incoming.deadline && existing.deadline !== incoming.deadline) changed.push("截止日期");
  if (incoming.deadlineText && normalize(existing.deadlineText ?? "") !== normalize(incoming.deadlineText)) {
    changed.push("原文时间");
  }
  if (incoming.location && normalize(existing.location ?? "") !== normalize(incoming.location)) {
    changed.push("地点");
  }
  if (similarity(existing.action, incoming.action) < 0.62) changed.push("办理要求");
  const materialDelta = incoming.materials.some((item) => !existing.materials.some((old) => normalize(old) === normalize(item)));
  if (materialDelta) changed.push("材料");
  return changed;
}

export function relateTask(incoming: Task, existing: Task): TaskRelation | null {
  if (incoming.noticeId && existing.noticeId && incoming.noticeId === existing.noticeId
    && incoming.sourceQuote === existing.sourceQuote) {
    return { task: existing, score: 1, kind: "duplicate", changed: [] };
  }
  const titleSim = similarity(incoming.title, existing.title);
  const actionSim = similarity(incoming.action, existing.action);
  const quoteSim = similarity(incoming.sourceQuote, existing.sourceQuote);
  const overlap = materialOverlap(incoming.materials, existing.materials);
  const sameTitle = normalize(incoming.title) === normalize(existing.title);
  const titleContained = containsTitle(incoming.title, existing.title);
  const sameDeadlineText = Boolean(incoming.deadlineText)
    && normalize(incoming.deadlineText ?? "") === normalize(existing.deadlineText ?? "");
  let score = Math.max(titleSim * 0.7 + actionSim * 0.3, quoteSim * 0.8);
  if (sameTitle) score = Math.max(score, 0.9);
  else if (titleContained) score = Math.max(score, 0.68);
  if (overlap >= 0.5) score = Math.max(score, 0.62 + overlap * 0.18);
  if (sameDeadlineText) score += 0.06;
  if (existing.deadline && incoming.deadline && existing.deadline === incoming.deadline) score += 0.04;
  score = Math.min(0.99, score);
  if (score < 0.56) return null;
  const changed = changedFields(existing, incoming);
  return { task: existing, score: Number(score.toFixed(2)), kind: changed.length ? "update" : "duplicate", changed };
}

export function findTaskRelations(incoming: Task, existing: Task[], limit = 3): TaskRelation[] {
  const scored = existing
    .filter((task) => task.id !== incoming.id && task.role === incoming.role)
    .map((task) => relateTask(incoming, task))
    .filter((item): item is TaskRelation => Boolean(item))
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) return [];
  const best = scored[0].score;
  return scored
    .filter((item) => item.score >= Math.max(0.56, best - 0.12))
    .slice(0, limit);
}

function unionMaterials(existing: string[], incoming: string[]) {
  const materials = [...existing];
  incoming.forEach((item) => {
    if (item && !materials.some((old) => normalize(old) === normalize(item))) materials.push(item);
  });
  return materials;
}

export function mergeIntoTask(existing: Task, incoming: Task): TaskPatch {
  const requirements = [existing.requirements, incoming.requirements]
    .filter((item): item is string => Boolean(item && item.trim()))
    .filter((item, index, all) => all.findIndex((other) => normalize(other) === normalize(item)) === index)
    .join("\n");
  const uncertainty = [existing.uncertainty, incoming.uncertainty]
    .filter((item): item is string => Boolean(item && item.trim()))
    .filter((item, index, all) => all.findIndex((other) => normalize(other) === normalize(item)) === index)
    .join("\n");
  return {
    materials: unionMaterials(existing.materials, incoming.materials),
    requirements: requirements || null,
    uncertainty: uncertainty || null,
    deadline: existing.deadline ?? incoming.deadline,
    deadlineText: existing.deadlineText ?? incoming.deadlineText,
    deadlineClock: existing.deadlineClock ?? incoming.deadlineClock ?? null,
    location: existing.location ?? incoming.location,
  };
}

export function updateTaskFrom(existing: Task, incoming: Task): TaskPatch {
  return {
    title: incoming.title,
    action: incoming.action,
    deadline: incoming.deadline,
    deadlineText: incoming.deadlineText,
    deadlineClock: incoming.deadlineClock ?? null,
    materials: unionMaterials(existing.materials, incoming.materials),
    category: incoming.category,
    uncertainty: incoming.uncertainty ?? existing.uncertainty ?? null,
    location: incoming.location ?? existing.location ?? null,
    requirements: incoming.requirements ?? existing.requirements ?? null,
  };
}