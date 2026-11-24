import type { ReminderLead, ReminderState, Task } from "../types";
import { clockFromDeadlineText, localDateString } from "./tasks.ts";

const DEFAULT_HOUR = 17;
const NOTIFY_REPEAT_MS = 60 * 60 * 1000;
const ACK_SUPPRESS_MS = 2 * 60 * 60 * 1000;

export function parseLocalDateTime(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocalDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${localDateString(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateTime(value: string | null | undefined) {
  const date = parseLocalDateTime(value);
  if (!date) return "未设置";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

export function normalizeChineseDateTime(dateText: string, hour: string, minute: string) {
  const date = dateText.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const h = Number(hour);
  const m = Number(minute);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const check = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
  if (check.getFullYear() !== Number(date.slice(0, 4))
    || check.getMonth() !== Number(date.slice(5, 7)) - 1
    || check.getDate() !== Number(date.slice(8, 10))) return null;
  return `${date}T${twoDigits(h)}:${twoDigits(m)}`;
}

export function minuteFromNow(now = new Date()) {
  const target = new Date(now.getTime() + 60 * 1000);
  if (target.getSeconds() > 0 || target.getMilliseconds() > 0) target.setMinutes(target.getMinutes() + 1);
  target.setSeconds(0, 0);
  return toLocalDateTime(target);
}

export function formatClock(value: string | null | undefined) {
  const date = parseLocalDateTime(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function deadlineTime(text: string | null | undefined, clock?: string | null) {
  const parsed = clockFromDeadlineText(clock) ?? clockFromDeadlineText(text);
  if (parsed) {
    return { hour: Number(parsed.slice(0, 2)), minute: Number(parsed.slice(3, 5)), estimated: false };
  }
  return { hour: DEFAULT_HOUR, minute: 0, estimated: true };
}

export function deadlineMoment(deadline: string | null, deadlineText: string | null, deadlineClock?: string | null) {
  if (!deadline) return null;
  const parts = deadline.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const { hour, minute } = deadlineTime(deadlineText, deadlineClock);
  return new Date(parts[0], parts[1] - 1, parts[2], hour, minute);
}

export function defaultReminderLead(deadline: string | null, deadlineText: string | null, now = new Date(), deadlineClock?: string | null): ReminderLead {
  const moment = deadlineMoment(deadline, deadlineText, deadlineClock);
  if (!moment) return "none";
  const oneDayEarly = new Date(moment.getTime() - 24 * 60 * 60 * 1000);
  if (oneDayEarly.getTime() > now.getTime() + 30 * 60 * 1000) return "1d";
  const twoHoursEarly = new Date(moment.getTime() - 2 * 60 * 60 * 1000);
  if (twoHoursEarly.getTime() > now.getTime() + 10 * 60 * 1000) return "2h";
  return "none";
}

export function reminderAtFor(
  deadline: string | null,
  deadlineText: string | null,
  lead: ReminderLead,
  customAt = "",
  deadlineClock?: string | null,
) {
  if (lead === "none") return null;
  if (lead === "custom") {
    const custom = parseLocalDateTime(customAt);
    return custom ? toLocalDateTime(custom) : null;
  }
  const moment = deadlineMoment(deadline, deadlineText, deadlineClock);
  if (!moment) return null;
  const offset = lead === "1d" ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
  return toLocalDateTime(new Date(moment.getTime() - offset));
}

export function reminderLeadLabel(lead: ReminderLead) {
  if (lead === "1d") return "提前一天";
  if (lead === "2h") return "提前两小时";
  if (lead === "custom") return "自定义时间";
  return "不提醒";
}

export function reminderExplainer(task: Pick<Task, "deadline" | "deadlineText" | "deadlineClock">) {
  if (!task.deadline) return "没有确认的具体日期，只能设置自定义提醒。";
  const { hour, minute, estimated } = deadlineTime(task.deadlineText, task.deadlineClock);
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return estimated
    ? `原文没有具体时刻，按当天 ${clock} 估算；可在“自定义”里改。`
    : `按原文时间 ${clock} 计算。`;
}

export function isReminderDue(reminder: ReminderState | undefined, task: Task, now = new Date()) {
  if (!reminder || task.status === "done" || task.category === "fyi") return false;
  const at = parseLocalDateTime(reminder.at);
  if (!at || at.getTime() > now.getTime()) return false;
  const postponed = parseLocalDateTime(reminder.postponedUntil);
  return !postponed || postponed.getTime() <= now.getTime();
}

export function shouldNotify(reminder: ReminderState | undefined, task: Task, now = new Date()) {
  if (!isReminderDue(reminder, task, now) || !reminder) return false;
  const notified = reminder.notifiedAt ? new Date(reminder.notifiedAt).getTime() : 0;
  if (notified && now.getTime() - notified < NOTIFY_REPEAT_MS) return false;
  const acknowledged = reminder.acknowledgedAt ? new Date(reminder.acknowledgedAt).getTime() : 0;
  if (acknowledged && now.getTime() - acknowledged < ACK_SUPPRESS_MS) return false;
  return true;
}

export function postponeChoices(now = new Date()) {
  const fifteen = new Date(now.getTime() + 15 * 60 * 1000);
  const oneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const tonight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0);
  if (tonight.getTime() <= now.getTime()) tonight.setDate(tonight.getDate() + 1);
  return [
    { id: "15m" as const, label: "15 分钟后", until: toLocalDateTime(fifteen) },
    { id: "1h" as const, label: "1 小时后", until: toLocalDateTime(oneHour) },
    { id: "tonight" as const, label: "今晚 20:00", until: toLocalDateTime(tonight) },
  ];
}

export function postponeReminder(reminder: ReminderState, until: string): ReminderState {
  return { ...reminder, postponedUntil: until, acknowledgedAt: null, notifiedAt: null };
}

export function acknowledgeReminder(reminder: ReminderState, now = new Date()): ReminderState {
  return { ...reminder, acknowledgedAt: now.toISOString() };
}

export function wasReminderAcknowledgedRecently(reminder: ReminderState | undefined, now = new Date()) {
  if (!reminder?.acknowledgedAt) return false;
  const acknowledged = new Date(reminder.acknowledgedAt).getTime();
  return Number.isFinite(acknowledged) && now.getTime() - acknowledged < ACK_SUPPRESS_MS;
}

export function summarizePriority(tasks: Task[], reminders: Record<string, ReminderState>, now = new Date()) {
  const today = localDateString(now);
  const soonLimit = localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3));
  const todo = tasks.filter((task) => task.status === "todo" && task.category !== "fyi");
  return {
    overdue: todo.filter((task) => Boolean(task.deadline && task.deadline < today)),
    dueSoon: todo.filter((task) => Boolean(task.deadline && task.deadline >= today && task.deadline <= soonLimit)),
    reminded: todo.filter((task) => {
      const reminder = reminders[task.id];
      return isReminderDue(reminder, task, now) && !wasReminderAcknowledgedRecently(reminder, now);
    }),
  };
}

export function reminderBadgeLabel(reminder: ReminderState | undefined, task: Task, now = new Date()) {
  if (!reminder) return "";
  if (isReminderDue(reminder, task, now)) {
    const postponed = parseLocalDateTime(reminder.postponedUntil);
    return postponed && postponed.getTime() > now.getTime() ? `推迟到 ${formatClock(reminder.postponedUntil)}` : "已提醒";
  }
  return `提醒 ${formatDateTime(reminder.at)}`;
}