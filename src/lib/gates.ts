import { z } from "zod";
import type { Category, Role, Task } from "../types";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const rawTaskSchema = z.object({
  id: z.string().min(1),
  noticeId: z.string().optional(),
  role: z.enum(["student", "counselor"]).optional(),
  title: z.string().min(1),
  action: z.string().min(1),
  deadline: z.union([z.string().regex(datePattern), z.null()]).optional(),
  deadlineText: z.string().nullable().optional(),
  materials: z.array(z.string()).optional(),
  category: z.enum(["fyi", "action", "needs_confirm"]).optional(),
  status: z.enum(["todo", "done"]).optional(),
  sourceQuote: z.string().min(1),
  sourceStart: z.number().nullable().optional(),
  sourceEnd: z.number().nullable().optional(),
  origin: z.enum(["verified_seed", "cloud_agent", "local_fixture", "verified_offline"]).optional(),
  sourceImageId: z.string().min(1).nullable().optional(),
  uncertainty: z.string().max(500).nullable().optional(),
  relevance: z.enum(["required", "optional", "conditional", "unknown"]).optional(),
  location: z.string().max(120).nullable().optional(),
  requirements: z.string().max(1000).nullable().optional(),
});

export interface EvidenceImage {
  imageId: string;
  text: string;
  uncertain?: boolean;
}

export function evidenceTextForTask(
  task: Pick<Task, "sourceImageId" | "sourceQuote">,
  body: string,
  imageReads: EvidenceImage[] = [],
) {
  if (task.sourceImageId) {
    const read = imageReads.find((item) => item.imageId === task.sourceImageId);
    if (read) return read.text;
  }
  return body;
}

export function findEvidenceImageId(quote: string, body: string, imageReads: EvidenceImage[]) {
  if (quote && body.includes(quote)) return null;
  const matches = imageReads.filter((item) => item.text.includes(quote));
  if (matches.length === 1) return matches[0].imageId;
  if (matches.length > 1) return undefined;
  return null;
}

const vagueDeadlinePattern = /尽快|最好这周|这周五还是下周五|下周五还是这周五|待通知|另行通知|尚未公布|还没公布|他没说|没说|具体啥时候|等课程平台|等通知|本周内|截止未公布|啥时候截止|截止日期等待/;

const chatOrSocialPattern = /约饭|一起吃饭|二食堂|去操场打球|还去操场|打球的还是|晚饭还是|先吃饭|去图书馆吗|七点见|老地方|晚上食堂吗/;
const shareOnlyPattern = /不是作业|不是要交的材料|不是要交的|不是交作业|需要的自取|要用的自取|对照例题|课堂练习|课堂笔记|供参考|先了解即可/;
const ackOnlyPattern = /^(收到|好的|谢谢|谢谢杨柳|谢谢马老师)[。！!～~]*$/;

const fileClarification = /群文件(哪个|哪一个)|哪个群文件|报名表是群文件|表在哪|别下错了/;
const voluntaryClarification = /是否强制|是强制的吗|不是强制|不是强制的/;
const filenameClarification = /中文还是拼音|文件名里的姓名|跟学籍一致/;

const ellipsisJoinPattern = /…|⋯|⋮|\.{3}/;

export function locateSourceSpan(body: string, sourceQuote: string) {
  if (!sourceQuote) return { sourceStart: null, sourceEnd: null };
  return locateContinuousSpan(body, sourceQuote) ?? { sourceStart: null, sourceEnd: null };
}

function locateContinuousSpan(body: string, sourceQuote: string) {
  if (!sourceQuote) return null;
  const exact = body.indexOf(sourceQuote);
  if (exact >= 0) return { sourceStart: exact, sourceEnd: exact + sourceQuote.length };
  const trimmed = sourceQuote.trim();
  if (trimmed && trimmed !== sourceQuote) {
    const at = body.indexOf(trimmed);
    if (at >= 0) return { sourceStart: at, sourceEnd: at + trimmed.length };
  }
  if (ellipsisJoinPattern.test(sourceQuote)) return null;
  return locateCompactSpan(body, trimmed || sourceQuote);
}

function splitEllipsisParts(sourceQuote: string) {
  return sourceQuote
    .split(/\s*(?:…|⋯|⋮|\.{3})+\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
}

function onlyWhitespaceBetween(body: string, start: number, end: number) {
  return start <= end && /^\s*$/.test(body.slice(start, end));
}

export function resolveSourceQuote(body: string, sourceQuote: string) {
  const direct = locateContinuousSpan(body, sourceQuote);
  if (direct) {
    return {
      sourceQuote: body.slice(direct.sourceStart, direct.sourceEnd),
      sourceStart: direct.sourceStart,
      sourceEnd: direct.sourceEnd,
      spliced: false,
    };
  }

  const parts = splitEllipsisParts(sourceQuote);
  const spans = parts
    .map((part) => locateContinuousSpan(body, part))
    .filter((span): span is { sourceStart: number; sourceEnd: number } => Boolean(span))
    .sort((left, right) => left.sourceStart - right.sourceStart);

  if (spans.length >= 2) {
    const first = spans[0];
    const last = spans[spans.length - 1];
    let adjacent = true;
    for (let index = 1; index < spans.length; index += 1) {
      if (!onlyWhitespaceBetween(body, spans[index - 1].sourceEnd, spans[index].sourceStart)) {
        adjacent = false;
        break;
      }
    }
    if (adjacent) {
      return {
        sourceQuote: body.slice(first.sourceStart, last.sourceEnd),
        sourceStart: first.sourceStart,
        sourceEnd: last.sourceEnd,
        spliced: false,
      };
    }
  }

  if (spans.length >= 1) {
    const best = spans.reduce((current, item) => (
      item.sourceEnd - item.sourceStart > current.sourceEnd - current.sourceStart ? item : current
    ));
    return {
      sourceQuote: body.slice(best.sourceStart, best.sourceEnd),
      sourceStart: best.sourceStart,
      sourceEnd: best.sourceEnd,
      spliced: parts.length >= 2,
    };
  }

  return { sourceQuote: "", sourceStart: null, sourceEnd: null, spliced: parts.length >= 2 || ellipsisJoinPattern.test(sourceQuote) };
}

export function applySourceQuoteGate<T extends Pick<Task, "sourceQuote" | "sourceStart" | "sourceEnd" | "category">>(task: T, body: string): T {
  const resolved = resolveSourceQuote(body, task.sourceQuote);
  const broken = resolved.spliced || resolved.sourceStart === null;
  return {
    ...task,
    sourceQuote: resolved.sourceQuote,
    sourceStart: resolved.sourceStart,
    sourceEnd: resolved.sourceEnd,
    category: broken && task.category !== "fyi" ? "needs_confirm" : task.category,
  };
}

function locateCompactSpan(body: string, quote: string) {
  const compactQuote = quote.replace(/\s+/g, "");
  if (compactQuote.length < 4) return null;
  const map: number[] = [];
  let compactBody = "";
  for (let index = 0; index < body.length; index += 1) {
    if (/\s/.test(body[index])) continue;
    map.push(index);
    compactBody += body[index];
  }
  const first = compactBody.indexOf(compactQuote);
  if (first < 0) return null;
  if (compactBody.indexOf(compactQuote, first + 1) >= 0) return null;
  const sourceStart = map[first];
  const last = map[first + compactQuote.length - 1];
  if (sourceStart == null || last == null) return null;
  return { sourceStart, sourceEnd: last + 1 };
}

export function isContinuousQuote(body: string, sourceQuote: string) {
  if (!sourceQuote) return false;
  if (body.includes(sourceQuote) || body.includes(sourceQuote.trim())) return true;
  if (ellipsisJoinPattern.test(sourceQuote)) return false;
  return locateCompactSpan(body, sourceQuote.trim()) !== null;
}

export function isVagueDeadlineText(...parts: Array<string | null | undefined>) {
  return vagueDeadlinePattern.test(parts.filter(Boolean).join("\n"));
}

export function repairExtractedTask<T extends Pick<Task, "sourceQuote" | "sourceStart" | "sourceEnd" | "category" | "deadline" | "deadlineText" | "sourceImageId" | "reviewed">>(
  task: T,
  body: string,
  imageReads: EvidenceImage[] = [],
): T {
  const evidence = evidenceTextForTask(task, body, imageReads);
  let next = applySourceQuoteGate(task, evidence);
  if (task.reviewed) return next;
  next = applyDeadlineGate(next);
  const readUncertain = task.sourceImageId
    ? Boolean(imageReads.find((item) => item.imageId === task.sourceImageId)?.uncertain)
    : false;
  if (readUncertain) {
    next = { ...next, category: "needs_confirm" };
  } else if (next.category !== "fyi" && next.deadline == null) {
    next = { ...next, category: "needs_confirm" };
  }
  return next;
}

export function applyDeadlineGate<T extends Pick<Task, "deadline" | "deadlineText" | "category" | "sourceQuote">>(task: T): T {
  if (!isVagueDeadlineText(task.deadlineText, task.sourceQuote)) return task;
  return { ...task, deadline: null, category: "needs_confirm" as Category };
}

function textBlob(task: Pick<Task, "title" | "action" | "sourceQuote">, extra = "") {
  return `${task.title}\n${task.action}\n${task.sourceQuote}\n${extra}`;
}

function looksLikeAcknowledgement(task: Pick<Task, "title" | "action" | "sourceQuote">) {
  return ackOnlyPattern.test(task.title.trim()) || ackOnlyPattern.test(task.sourceQuote.trim()) || ackOnlyPattern.test(task.action.trim());
}

export function shouldDropAsNonAction(task: Pick<Task, "title" | "action" | "sourceQuote">, doNotExtract: string[] = []) {
  const blob = textBlob(task);
  if (looksLikeAcknowledgement(task)) return true;
  if (chatOrSocialPattern.test(blob) || shareOnlyPattern.test(blob)) return true;
  return doNotExtract.some((item) => {
    const hint = item.trim();
    if (hint.length < 4) return false;
    if (blob.includes(hint)) return true;
    const keywords = hint.split(/[、，,；;（）()]/).map((part) => part.trim()).filter((part) => part.length >= 4);
    return keywords.length > 0 && keywords.some((keyword) => blob.includes(keyword) && !/自愿|报名表|志愿者|截止|提交|答辩/.test(keyword));
  });
}

export type ClarificationKind = "file" | "voluntary" | "filename";

export function detectClarification(task: Pick<Task, "title" | "action" | "sourceQuote">): ClarificationKind | null {
  const blob = textBlob(task);
  if (fileClarification.test(blob)) return "file";
  if (voluntaryClarification.test(blob)) return "voluntary";
  if (filenameClarification.test(blob)) return "filename";
  return null;
}

export function findMergeTarget(task: Pick<Task, "title" | "action" | "sourceQuote" | "noticeId">, accepted: Task[]): Task | undefined {
  const kind = detectClarification(task);
  if (!kind) return undefined;
  const sameNotice = accepted.filter((item) => !task.noticeId || !item.noticeId || item.noticeId === task.noticeId);
  if (kind === "file") return sameNotice.find((item) => /普通话报名|报名表/.test(textBlob(item)));
  if (kind === "voluntary") return sameNotice.find((item) => /迎新志愿者|志愿者/.test(textBlob(item)));
  return sameNotice.find((item) => /课程设计|提交|命名/.test(textBlob(item)));
}

function mergeInto(target: Task, incoming: Task): Task {
  const materials = [...target.materials];
  for (const item of incoming.materials) {
    if (item && !materials.includes(item)) materials.push(item);
  }
  return { ...target, materials };
}

function isDuplicate(task: Task, accepted: Task[]) {
  return accepted.some((item) => {
    if (item.sourceQuote && item.sourceQuote === task.sourceQuote) return true;
    return item.title === task.title && item.action === task.action && item.noticeId === task.noticeId;
  });
}

export function gateExtractedTasks(input: {
  body: string;
  role: Role;
  noticeId: string;
  tasks: unknown[];
  existingTasks?: Task[];
  imageReads?: EvidenceImage[];
  doNotExtract?: string[];
  origin?: Task["origin"];
  keepExistingDuplicates?: boolean;
}): Task[] {
  const accepted: Task[] = [];
  const imageReads = input.imageReads ?? [];
  const existing = input.keepExistingDuplicates ? [] : (input.existingTasks ?? []);

  for (const raw of input.tasks) {
    const parsed = rawTaskSchema.safeParse(raw);
    if (!parsed.success) continue;
    const value = parsed.data;
    const quote = value.sourceQuote.trim();
    let sourceImageId = value.sourceImageId ?? null;
    if (!sourceImageId) {
      const found = findEvidenceImageId(quote, input.body, imageReads);
      if (found === undefined) continue;
      sourceImageId = found;
    }
    const read = sourceImageId ? imageReads.find((item) => item.imageId === sourceImageId) : undefined;
    const evidence = sourceImageId ? (read?.text ?? "") : input.body;
    if (!evidence) continue;
    const resolved = resolveSourceQuote(evidence, quote);
    const quoteMissing = resolved.sourceStart === null;
    const uncertain = Boolean(read?.uncertain);
    let task: Task = {
      id: value.id,
      noticeId: input.noticeId || value.noticeId || "",
      role: input.role,
      title: value.title.trim(),
      action: value.action.trim(),
      deadline: value.deadline ?? null,
      deadlineText: value.deadlineText ?? null,
      materials: value.materials ?? [],
      category: quoteMissing || resolved.spliced || uncertain ? "needs_confirm" : (value.category ?? "action"),
      status: value.status ?? "todo",
      sourceQuote: resolved.sourceQuote,
      sourceStart: resolved.sourceStart,
      sourceEnd: resolved.sourceEnd,
      origin: input.origin ?? value.origin,
      sourceImageId,
      uncertainty: value.uncertainty ?? null,
      relevance: value.relevance ?? "required",
      location: value.location ?? null,
      requirements: value.requirements ?? null,
    };
    task = applyDeadlineGate(task);
    if (task.category !== "fyi" && task.deadline == null) {
      task = { ...task, category: "needs_confirm" };
    }
    if (uncertain && value.category !== "fyi") {
      task = { ...task, category: "needs_confirm" };
    }

    const mergeSource = [...accepted, ...existing];
    const target = findMergeTarget(task, mergeSource);
    if (target) {
      const index = accepted.findIndex((item) => item.id === target.id);
      if (index >= 0) accepted[index] = mergeInto(accepted[index], task);
      continue;
    }
    if (shouldDropAsNonAction(task, input.doNotExtract ?? [])) continue;
    if (isDuplicate(task, [...accepted, ...existing])) continue;
    accepted.push(task);
  }

  return accepted;
}
