import type { Notice, Role, RoleState } from "../types";

export const STORAGE_PREFIX = "notice-desk:v1:";

export function emptyState(): RoleState {
  return {
    read: {},
    done: {},
    deadlines: {},
    customNotices: [],
    customTasks: [],
    demoComplete: false,
    tourDismissed: false,
    reminders: {},
    taskPatches: {},
    hiddenNoticeIds: [],
  };
}

export function hydrateRoleState(raw: string | null): RoleState {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<RoleState>;
    return {
      ...emptyState(),
      ...parsed,
      read: parsed.read ?? {},
      done: parsed.done ?? {},
      deadlines: parsed.deadlines ?? {},
      customNotices: Array.isArray(parsed.customNotices) ? parsed.customNotices : [],
      customTasks: Array.isArray(parsed.customTasks) ? parsed.customTasks : [],
      reminders: parsed.reminders ?? {},
      taskPatches: parsed.taskPatches ?? {},
      hiddenNoticeIds: Array.isArray(parsed.hiddenNoticeIds) ? parsed.hiddenNoticeIds : [],
      demoComplete: false,
    };
  } catch {
    return emptyState();
  }
}

function withoutScreenshotData(state: RoleState): RoleState {
  return {
    ...state,
    customNotices: state.customNotices.map((notice: Notice) => (
      notice.screenshots?.length
        ? { ...notice, screenshots: notice.screenshots.map((image) => ({ ...image, data: "" })) }
        : notice
    )),
  };
}

export function serializeRoleState(state: RoleState, options: { keepImages?: boolean } = {}): string {
  const value = options.keepImages === false ? withoutScreenshotData(state) : state;
  return JSON.stringify({ ...value, demoComplete: false });
}

export function roleStorageKey(role: Role) {
  return `${STORAGE_PREFIX}${role}`;
}

export function loadState(role: Role): RoleState {
  try {
    return hydrateRoleState(localStorage.getItem(roleStorageKey(role)));
  } catch {
    return emptyState();
  }
}

export type PersistOutcome = "ok" | "trimmed" | "failed";

export function persistRoleStates(states: Record<Role, RoleState>): PersistOutcome {
  const roles = Object.keys(states) as Role[];
  try {
    roles.forEach((role) => {
      localStorage.setItem(roleStorageKey(role), serializeRoleState(states[role]));
    });
    return "ok";
  } catch {
    try {
      roles.forEach((role) => {
        localStorage.setItem(roleStorageKey(role), serializeRoleState(states[role], { keepImages: false }));
      });
      return "trimmed";
    } catch {
      return "failed";
    }
  }
}