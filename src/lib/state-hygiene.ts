import type { Role, RoleState } from "../types";

interface HygieneInput {
  role: Role;
  seedNoticeIds: string[];
  seedTaskIds: string[];
}

interface RemoveNoticeOptions {
  hideSeedNotice?: boolean;
  extraTaskIds?: string[];
}

function keepKnown<T>(record: Record<string, T>, known: Set<string>) {
  return Object.fromEntries(Object.entries(record).filter(([id]) => known.has(id)));
}

function dropKnown<T>(record: Record<string, T>, removed: Set<string>) {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !removed.has(id)));
}

export function pruneRoleState(state: RoleState, input: HygieneInput): RoleState {
  const customNotices = state.customNotices.filter((notice) => notice.role === input.role);
  const noticeIds = new Set([...input.seedNoticeIds, ...customNotices.map((notice) => notice.id)]);
  const customTasks = state.customTasks.filter((task) => task.role === input.role && noticeIds.has(task.noticeId));
  const taskIds = new Set([...input.seedTaskIds, ...customTasks.map((task) => task.id)]);
  return {
    ...state,
    read: keepKnown(state.read, noticeIds),
    done: keepKnown(state.done, taskIds),
    deadlines: keepKnown(state.deadlines, taskIds),
    customNotices,
    customTasks,
    reminders: keepKnown(state.reminders, taskIds),
    taskPatches: keepKnown(state.taskPatches, taskIds),
    hiddenNoticeIds: (state.hiddenNoticeIds ?? []).filter((id) => input.seedNoticeIds.includes(id)),
  };
}

/** Removes one notice plus every local task/reminder reference it owns. */
export function removeNoticeFromState(state: RoleState, noticeId: string, options: RemoveNoticeOptions = {}): RoleState {
  const removedTaskIds = new Set([
    ...state.customTasks.filter((task) => task.noticeId === noticeId).map((task) => task.id),
    ...(options.extraTaskIds ?? []),
  ]);
  const read = { ...state.read };
  delete read[noticeId];
  const hiddenNoticeIds = state.hiddenNoticeIds ?? [];
  return {
    ...state,
    read,
    done: dropKnown(state.done, removedTaskIds),
    deadlines: dropKnown(state.deadlines, removedTaskIds),
    customNotices: state.customNotices.filter((notice) => notice.id !== noticeId),
    customTasks: state.customTasks.filter((task) => task.noticeId !== noticeId),
    reminders: dropKnown(state.reminders, removedTaskIds),
    taskPatches: dropKnown(state.taskPatches, removedTaskIds),
    hiddenNoticeIds: options.hideSeedNotice && !hiddenNoticeIds.includes(noticeId)
      ? [...hiddenNoticeIds, noticeId]
      : hiddenNoticeIds,
  };
}