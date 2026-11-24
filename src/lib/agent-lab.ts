import { evidenceTextForTask, type EvidenceImage } from "./gates.ts";
import type { Task } from "../types";

export interface LabQuoteCheck {
  taskId: string;
  title: string;
  ok: boolean;
  start: number | null;
  end: number | null;
  imageId: string | null;
}

export interface LabDeadlineCheck {
  taskId: string;
  title: string;
  deadlineText: string | null;
  deadline: string | null;
  confirmed: boolean;
}

export interface LabVerification {
  total: number;
  quoteOk: number;
  quoteBroken: number;
  dated: number;
  needsConfirm: number;
  fyi: number;
  quotes: LabQuoteCheck[];
  deadlines: LabDeadlineCheck[];
}

export function verifyLabResult(body: string, tasks: Task[], imageReads: EvidenceImage[] = []): LabVerification {
  const quotes = tasks.map((task) => {
    const start = task.sourceStart;
    const end = task.sourceEnd;
    const evidence = evidenceTextForTask(task, body, imageReads);
    const ok = start !== null
      && end !== null
      && start >= 0
      && end <= evidence.length
      && evidence.slice(start, end) === task.sourceQuote;
    return { taskId: task.id, title: task.title, ok, start, end, imageId: task.sourceImageId ?? null };
  });

  const deadlines = tasks.map((task) => ({
    taskId: task.id,
    title: task.title,
    deadlineText: task.deadlineText,
    deadline: task.deadline,
    confirmed: task.deadline !== null && task.category !== "needs_confirm",
  }));

  return {
    total: tasks.length,
    quoteOk: quotes.filter((item) => item.ok).length,
    quoteBroken: quotes.filter((item) => !item.ok).length,
    dated: tasks.filter((task) => task.deadline !== null).length,
    needsConfirm: tasks.filter((task) => task.category === "needs_confirm").length,
    fyi: tasks.filter((task) => task.category === "fyi").length,
    quotes,
    deadlines,
  };
}