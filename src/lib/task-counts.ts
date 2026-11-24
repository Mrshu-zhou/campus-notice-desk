import type { Task } from "../types";

export function isIncompleteTask(task: Task) {
  return task.status === "todo" && task.category !== "fyi";
}

export function countIncompleteTasks(tasks: Task[]) {
  return tasks.filter(isIncompleteTask).length;
}

export function countDoneTasks(tasks: Task[]) {
  return tasks.filter((task) => task.status === "done").length;
}

export function summarizeTaskCounts(tasks: Task[], today = "") {
  return {
    total: tasks.length,
    needsConfirm: tasks.filter((task) => task.category === "needs_confirm").length,
    fyi: tasks.filter((task) => task.category === "fyi").length,
    overdue: today
      ? tasks.filter((task) => task.status === "todo" && task.category !== "fyi" && Boolean(task.deadline && task.deadline < today)).length
      : 0,
  };
}

export function formatTaskCountLabel(counts: ReturnType<typeof summarizeTaskCounts>) {
  const parts = [`${counts.total} 件`];
  if (counts.needsConfirm > 0) parts.push(`${counts.needsConfirm} 件待确认`);
  if (counts.fyi > 0) parts.push(`${counts.fyi} 件仅阅知`);
  if (counts.overdue > 0) parts.push(`${counts.overdue} 件已过期`);
  return parts.join(" · ");
}
