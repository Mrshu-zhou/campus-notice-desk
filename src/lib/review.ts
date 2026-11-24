import { mergeIntoTask, updateTaskFrom } from "./dedupe.ts";
import type {
  Category,
  ExtractionResult,
  ImageRead,
  IgnoredItem,
  Notice,
  ReminderLead,
  ReminderState,
  Role,
  SourceImage,
  SourceType,
  Task,
  TaskPatch,
} from "../types";

export type RelevanceChoice = "need" | "not_mine" | "later";
export type RelationChoice = "merge" | "update" | "create_new" | "skip";

export interface CandidateEdits {
  selected: boolean;
  title: string;
  action: string;
  deadline: string;
  deadlineText: string | null;
  deadlineClock?: string | null;
  materialsText: string;
  location: string;
  requirements: string;
  relevance: RelevanceChoice;
  confirmActionable: boolean;
  relationChoice: RelationChoice;
  relationTaskId: string;
  reminderLead: ReminderLead;
  customReminderAt: string;
}

export interface ReviewDecision {
  task: Task;
  relationChoice: RelationChoice;
  relationTaskId: string;
  reminderAt: string | null;
  reminderLead: ReminderLead;
}

export function splitMaterials(value: string) {
  return value
    .split(/[\n、,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const LOGIN_NOTE_PATTERN = /学号|身份证|初始密码|密码|验证码|Vpn|VPN|vpn|登录|登陆|校园网账号/;

export function partitionMaterials(items: string[]) {
  const materials: string[] = [];
  const loginNotes: string[] = [];
  items.forEach((item) => {
    const value = item.trim();
    if (!value) return;
    if (LOGIN_NOTE_PATTERN.test(value)) loginNotes.push(value);
    else if (!materials.includes(value)) materials.push(value);
  });
  return { materials, loginNotes };
}

export function defaultCandidateDecision(task: Task): Pick<CandidateEdits, "selected" | "relevance"> {
  if (task.category === "fyi") return { selected: false, relevance: "not_mine" };
  if (task.category === "needs_confirm") return { selected: true, relevance: "later" };
  return { selected: true, relevance: "need" };
}

const IMAGE_UNCERTAIN_PATTERN = /看不清|裁切|遮挡|模糊|不确定|无法确认|缺失/;

export function buildReviewedTask(base: Task, edits: CandidateEdits, noticeId: string): Task | null {
  if (!edits.selected || edits.relevance === "not_mine") return null;
  if (base.category === "fyi" && edits.relevance !== "need") return null;
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(edits.deadline) ? edits.deadline : null;
  const action = edits.action.trim() || base.action;
  let category: Category = base.category;
  if (base.category === "needs_confirm") {
    const imageBlocksConfirmation = Boolean(base.sourceImageId)
      && Boolean(base.uncertainty && IMAGE_UNCERTAIN_PATTERN.test(base.uncertainty));
    const canConfirm = edits.confirmActionable && Boolean(deadline) && !imageBlocksConfirmation;
    if (canConfirm) category = "action";
  }
  // 仅阅知项只有用户明确改选「要办」后才进入待办。
  if (base.category === "fyi") category = deadline ? "action" : "needs_confirm";
  if (edits.relevance === "later") category = "needs_confirm";
  if (category === "action" && !deadline) category = "needs_confirm";
  const materialParts = partitionMaterials(splitMaterials(edits.materialsText));
  const requirements = [edits.requirements.trim(), ...materialParts.loginNotes].filter(Boolean).join("\n");
  return {
    ...base,
    noticeId,
    title: edits.title.trim() || base.title,
    action,
    deadline,
    deadlineText: edits.deadlineText,
    deadlineClock: edits.deadlineClock?.trim() || null,
    materials: materialParts.materials,
    location: edits.location.trim() || null,
    requirements: requirements || null,
    category,
    relevance: edits.relevance === "need" ? "required" : edits.relevance === "later" ? "unknown" : base.relevance,
    reviewed: true,
  };
}

export function describeReviewOutcome(outcome: ApplyReviewOutput, manualSkipped = 0) {
  const details: string[] = [];
  if (outcome.newTasks.length) details.push(`新增 ${outcome.newTasks.length} 条`);
  if (outcome.merged) details.push(`合并 ${outcome.merged} 条`);
  if (outcome.updated) details.push(`更新 ${outcome.updated} 条`);
  const skipped = outcome.skipped + manualSkipped;
  if (skipped) details.push(`跳过 ${skipped} 条`);
  return details.length ? details.join("，") : "本次没有加入待办";
}

function mergePatch(existing: Task, incoming: Task, choice: "merge" | "update"): TaskPatch {
  return choice === "merge" ? mergeIntoTask(existing, incoming) : updateTaskFrom(existing, incoming);
}

function combinePatch(previous: TaskPatch | undefined, next: TaskPatch): TaskPatch {
  if (!previous) return next;
  const materials = [...(previous.materials ?? [])];
  (next.materials ?? []).forEach((item) => {
    if (!materials.includes(item)) materials.push(item);
  });
  return {
    ...previous,
    ...next,
    materials,
    requirements: next.requirements ?? previous.requirements,
    uncertainty: next.uncertainty ?? previous.uncertainty,
    location: next.location ?? previous.location,
  };
}

export interface ApplyReviewInput {
  noticeId: string;
  decisions: ReviewDecision[];
  existingTasks: Task[];
}

export interface ApplyReviewOutput {
  newTasks: Task[];
  patches: Record<string, TaskPatch>;
  reminders: Record<string, ReminderState>;
  skipped: number;
  merged: number;
  updated: number;
}

export function applyReviewDecisions(input: ApplyReviewInput): ApplyReviewOutput {
  const working = new Map(input.existingTasks.map((task) => [task.id, task]));
  const patches: Record<string, TaskPatch> = {};
  const reminders: Record<string, ReminderState> = {};
  const newTasks: Task[] = [];
  let skipped = 0;
  let merged = 0;
  let updated = 0;

  for (const decision of input.decisions) {
    if (decision.relationChoice === "skip") {
      skipped += 1;
      continue;
    }
    if (decision.relationChoice === "merge" || decision.relationChoice === "update") {
      const target = working.get(decision.relationTaskId);
      if (!target) {
        skipped += 1;
        continue;
      }
      const patch = { ...mergePatch(target, decision.task, decision.relationChoice), reviewed: true };
      patches[target.id] = combinePatch(patches[target.id], patch);
      working.set(target.id, { ...target, ...patch });
      if (decision.reminderAt) {
        reminders[target.id] = { at: decision.reminderAt, lead: decision.reminderLead, notifiedAt: null, postponedUntil: null };
      }
      if (decision.relationChoice === "merge") merged += 1;
      else updated += 1;
      continue;
    }
    const task: Task = {
      ...decision.task,
      id: `task-${crypto.randomUUID()}`,
      noticeId: input.noticeId,
      status: "todo",
    };
    newTasks.push(task);
    working.set(task.id, task);
    if (decision.reminderAt) {
      reminders[task.id] = { at: decision.reminderAt, lead: decision.reminderLead, notifiedAt: null, postponedUntil: null };
    }
  }

  return { newTasks, patches, reminders, skipped, merged, updated };
}

export interface NoticeDraftInput {
  role: Role;
  sourceType: SourceType;
  sourceLabel: string;
  segments: string[];
  images: SourceImage[];
  imageReads: ImageRead[];
  ignored: IgnoredItem[];
  mode: ExtractionResult["mode"];
  returned: number;
  accepted: number;
  titleHint?: string;
}

export function buildReviewNotice(input: NoticeDraftInput): Notice {
  const reads = new Map(input.imageReads.map((read) => [read.imageId, read]));
  const screenshots: SourceImage[] = input.images.map((image) => {
    const read = reads.get(image.id);
    return {
      ...image,
      transcript: read?.text ?? image.transcript ?? "",
      uncertain: read?.uncertain ?? image.uncertain ?? false,
      notes: read?.notes ?? image.notes ?? "",
    };
  });
  const body = input.segments.map((segment) => segment.trim()).filter(Boolean).join("\n\n");
  const firstText = input.titleHint
    ?? input.segments.find((segment) => segment.trim())
    ?? screenshots.find((image) => image.transcript)?.transcript
    ?? body;
  const firstLine = (firstText ?? "通知").split("\n").find((line) => line.trim())?.trim() ?? "通知";
  return {
    id: `notice-${crypto.randomUUID()}`,
    role: input.role,
    sourceType: input.sourceType,
    sourceLabel: input.sourceLabel,
    title: firstLine.slice(0, 42),
    body,
    receivedAt: new Date().toISOString(),
    read: false,
    adapter: "paste_import",
    screenshots,
    ignored: input.ignored,
    extraction: { mode: input.mode, returned: input.returned, accepted: input.accepted },
  };
}

export function imageReadsFromNotice(notice: Notice): ImageRead[] {
  return (notice.screenshots ?? [])
    .filter((image) => Boolean(image.transcript))
    .map((image) => ({
      imageId: image.id,
      text: image.transcript ?? "",
      uncertain: Boolean(image.uncertain),
      notes: image.notes ?? "",
    }));
}