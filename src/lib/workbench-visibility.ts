import type { Notice, Role, Task } from "../types";

export function isStudentWorkbenchNotice(
  noticeId: string,
  demoStarted: boolean,
  sessionNoticeIds: string[],
  classNoticeId = "stu-wechat-class-forward",
) {
  if (noticeId === classNoticeId) return demoStarted;
  return sessionNoticeIds.includes(noticeId);
}

export function visibleWorkbenchNotices(
  notices: Notice[],
  role: Role,
  demoStarted: boolean,
  sessionNoticeIds: string[],
) {
  if (role !== "student") return notices.filter((notice) => notice.role === role);
  return notices.filter((notice) => isStudentWorkbenchNotice(notice.id, demoStarted, sessionNoticeIds));
}

export function visibleWorkbenchTasks(
  tasks: Task[],
  notices: Notice[],
) {
  const allowed = new Set(notices.map((notice) => notice.id));
  return tasks.filter((task) => allowed.has(task.noticeId));
}
