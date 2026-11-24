import noticeData from "../data/sample-notices.json" with { type: "json" };
import taskData from "../data/expected-tasks.json" with { type: "json" };
import { locateSourceSpan } from "./lib/gates.ts";
import type { Notice, PasteSample, Role, SourceType, Task } from "./types";

export const CLASS_NOTICE_ID = "stu-wechat-class-forward";
export const COUNSELOR_NOTICE_ID = "cou-email-stay-and-meeting";
export const CLASS_PRELUDE_COUNT = 3;

export { locateSourceSpan };

const rawNotices = noticeData.notices as Array<Omit<Notice, "read">>;
export const seedNotices: Notice[] = rawNotices.map((notice) => ({
  ...notice,
  read: ["stu-email-scholarship", "cou-fyi-classroom-booking"].includes(notice.id),
}));

export const seedTasks: Task[] = (taskData.tasks as Task[]).map((task) => {
  const notice = seedNotices.find((item) => item.id === task.noticeId);
  const span = notice ? locateSourceSpan(notice.body, task.sourceQuote) : { sourceStart: null, sourceEnd: null };
  return {
    ...task,
    ...span,
    category: span.sourceStart === null ? "needs_confirm" : task.category,
    origin: "verified_seed",
  };
});

export const pasteSamples = noticeData.pasteSamples as PasteSample[];

export interface NoticeAdapter {
  list(role: Role): Notice[];
  ingest(input: { role: Role; sourceType: SourceType; sourceLabel: string; body: string }): Notice;
}

export const demoSeedAdapter: NoticeAdapter = {
  list(role) {
    return seedNotices.filter((notice) => notice.role === role);
  },
  ingest() {
    throw new Error("demo_seed 仅提供预置通知，请使用 paste_import。 ");
  },
};

export const pasteImportAdapter: NoticeAdapter = {
  list() {
    return [];
  },
  ingest({ role, sourceType, sourceLabel, body }) {
    const firstLine = body.split("\n").find((line) => line.trim())?.trim() ?? "粘贴的通知";
    return {
      id: `paste-${crypto.randomUUID()}`,
      role,
      sourceType,
      sourceLabel,
      title: firstLine.slice(0, 42),
      body,
      receivedAt: new Date().toISOString(),
      read: false,
      adapter: "paste_import",
    };
  },
};

export const reservedAdapters = ["email", "wechat", "dingtalk"] as const;

export const sourceLabels: Record<SourceType, string> = {
  wechat_group: "班级群",
  dingtalk_or_wecom: "课程 / 工作群",
  email: "邮件",
  paste: "粘贴导入",
};
