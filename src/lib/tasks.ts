import type { RoleState, Task } from "../types";

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatShortDate(value: string | null) {
  if (!value) return "无日期";
  const [, month, day] = value.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

export function formatReceivedAt(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

const START_TIME_PATTERN = /开始|集合|开会|例会|班会|答辩|考试|演练|活动|讲座|会议|培训|仪式/;

function applyChinesePeriod(hour: number, period: string) {
  if ((period === "下午" || period === "傍晚" || period === "晚上" || period === "晚") && hour < 12) return hour + 12;
  if (period === "中午" && hour < 12) return hour + 12;
  return hour;
}

export function clockFromDeadlineText(text: string | null | undefined) {
  const value = text ?? "";
  const clock = /(?:^|[^\d:])(上午|早上|中午|下午|傍晚|晚上|晚)?\s*(\d{1,2})[:：](\d{2})/.exec(value);
  if (clock) {
    const hour = applyChinesePeriod(Number(clock[2]), clock[1] ?? "");
    const minute = Number(clock[3]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  const dian = /(上午|早上|中午|下午|傍晚|晚上|晚)?\s*(\d{1,2})\s*点半?/.exec(value);
  if (!dian) return null;
  const hour = applyChinesePeriod(Number(dian[2]), dian[1] ?? "");
  if (hour < 0 || hour > 23) return null;
  const minute = /点半/.test(dian[0]) ? 30 : 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatDeadlineLabel(deadline: string | null, deadlineText: string | null, deadlineClock?: string | null, context?: string | null) {
  if (!deadline) return deadlineText ? `${deadlineText}（具体日期待确认）` : "时间待确认";
  const prefix = START_TIME_PATTERN.test(`${deadlineText ?? ""} ${context ?? ""}`) ? "开始" : "截止";
  const clock = deadlineClock || clockFromDeadlineText(deadlineText);
  return `${prefix} ${formatShortDate(deadline)}${clock ? ` ${clock}` : ""}`;
}

export function normalizeClockInput(raw: string) {
  const value = raw.trim();
  const match = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function deadlineSourceNote(deadline: string | null, deadlineText: string | null) {
  if (!deadlineText) return deadline ? "原文没有单独写明时间" : "原文没有写出时间，可手动补上具体日期";
  return `原文：${deadlineText}${deadline ? "" : "；具体日期待确认"}`;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'，。；、）)】\]}（「『“《【〈〔［｛」』”’》］]+/g;
const URL_TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、）】」』”’》…]+$/u;

export function extractLinks(...texts: Array<string | null | undefined>) {
  const links: string[] = [];
  texts.forEach((text) => {
    if (!text) return;
    for (const match of text.matchAll(URL_PATTERN)) {
      const link = match[0].replace(URL_TRAILING_PUNCTUATION, "");
      if (link && !links.includes(link)) links.push(link);
    }
  });
  return links;
}

export function quoteContext(body: string, quote: string) {
  if (!body || !quote) return null;
  const at = body.indexOf(quote);
  if (at < 0) return null;
  const beforeBreak = body.lastIndexOf("\n\n", at);
  const afterBreak = body.indexOf("\n\n", at + quote.length);
  const start = beforeBreak < 0 ? 0 : beforeBreak + 2;
  const end = afterBreak < 0 ? body.length : afterBreak;
  const paragraph = body.slice(start, end).trim();
  if (!paragraph.includes(quote)) return null;
  return paragraph;
}

export function isOverdue(task: Task, today: string) {
  return task.status === "todo" && task.category !== "fyi" && Boolean(task.deadline && task.deadline < today);
}

export function isDueToday(task: Task, today: string) {
  return task.status === "todo" && task.category !== "fyi" && task.deadline === today;
}

export function compareTasks(a: Task, b: Task) {
  if (a.status !== b.status) return a.status === "todo" ? -1 : 1;
  if (a.category === "fyi" && b.category !== "fyi") return 1;
  if (b.category === "fyi" && a.category !== "fyi") return -1;
  if (!a.deadline && !b.deadline) return a.title.localeCompare(b.title, "zh-CN");
  if (!a.deadline) return 1;
  if (!b.deadline) return -1;
  return a.deadline.localeCompare(b.deadline);
}

export function applyRoleState(tasks: Task[], state: RoleState) {
  const patches = state.taskPatches ?? {};
  return tasks.map((task) => {
    const patch = patches[task.id];
    const patched = patch ? { ...task, ...patch } : task;
    const hasDeadlineOverride = Object.prototype.hasOwnProperty.call(state.deadlines, task.id);
    const deadline = hasDeadlineOverride ? state.deadlines[task.id] : patched.deadline;
    return {
      ...patched,
      status: state.done[task.id] ? "done" as const : "todo" as const,
      deadline,
      category: patched.category,
    };
  });
}

function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

export function tasksToCalendar(tasks: Task[]) {
  const events = tasks.filter((task) => task.deadline).map((task) => {
    const date = task.deadline!.replaceAll("-", "");
    const end = new Date(`${task.deadline}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const endDate = localDateString(end).replaceAll("-", "");
    return [
      "BEGIN:VEVENT",
      `UID:${task.id}@notice-desk.local`,
      `DTSTART;VALUE=DATE:${date}`,
      `DTEND;VALUE=DATE:${endDate}`,
      `SUMMARY:${escapeIcsText(task.title)}`,
      `DESCRIPTION:${escapeIcsText(`${task.action}\n原文时间：${task.deadlineText ?? "未提供"}`)}`,
      "END:VEVENT",
    ].join("\r\n");
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Notice Desk//ZH-CN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n");
}

export function downloadCalendar(tasks: Task[]) {
  const blob = new Blob([tasksToCalendar(tasks)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "校园通知待办.ics";
  anchor.click();
  URL.revokeObjectURL(url);
}
