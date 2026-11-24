import assert from "node:assert/strict";
import test from "node:test";

import { findTaskRelations, relateTask, updateTaskFrom } from "../src/lib/dedupe.ts";
import { repairExtractedTask, gateExtractedTasks } from "../src/lib/gates.ts";
import { assertImageBudget, imageDataUrl, imageFromDataUrl, totalImageChars } from "../src/lib/images.ts";
import { JUDGE_COPY, TOUR_STEPS } from "../src/lib/judge.ts";
import {
  acknowledgeReminder,
  defaultReminderLead,
  isReminderDue,
  minuteFromNow,
  postponeChoices,
  postponeReminder,
  reminderAtFor,
  shouldNotify,
  summarizePriority,
} from "../src/lib/reminders.ts";
import {
  applyReviewDecisions,
  buildReviewNotice,
  buildReviewedTask,
} from "../src/lib/review.ts";

function task(overrides = {}) {
  return {
    id: "cand-1",
    noticeId: "notice-new",
    role: "student",
    title: "签署并提交实验室安全准入承诺书",
    action: "下载承诺书，本人签名后交到信息楼A312",
    deadline: "2026-11-27",
    deadlineText: "11月27日17:00前",
    materials: ["承诺书"],
    category: "needs_confirm",
    status: "todo",
    sourceQuote: "11月27日17:00前交到信息楼A312",
    sourceStart: 0,
    sourceEnd: 17,
    ...overrides,
  };
}

function edits(overrides = {}) {
  return {
    selected: true,
    title: "签署并提交实验室安全准入承诺书",
    action: "下载承诺书，本人签名后交到信息楼A312",
    deadline: "2026-11-27",
    deadlineText: "11月27日17:00前",
    materialsText: "承诺书、学生证",
    location: "信息楼A312",
    requirements: "本人签名",
    relevance: "need",
    confirmActionable: true,
    relationChoice: "create_new",
    relationTaskId: "",
    reminderLead: "1d",
    customReminderAt: "",
    ...overrides,
  };
}

test("review notice keeps screenshot transcript, ignored reasons and text segments", () => {
  const notice = buildReviewNotice({
    role: "student",
    sourceType: "wechat_group",
    sourceLabel: "班级群",
    segments: ["第一段通知", "第二段补充"],
    images: [{ id: "img1", mediaType: "image/jpeg", data: "abc", name: "通知截图.jpg" }],
    imageReads: [{ imageId: "img1", text: "截图里读出的承诺书内容", uncertain: true, notes: "右侧被裁切" }],
    ignored: [{ text: "晚上食堂吗", reason: "chat" }],
    mode: "cloud_agent",
    returned: 3,
    accepted: 1,
    titleHint: "签署实验室安全承诺书",
  });
  assert.equal(notice.title, "签署实验室安全承诺书");
  assert.equal(notice.body, "第一段通知\n\n第二段补充");
  assert.equal(notice.screenshots[0].transcript, "截图里读出的承诺书内容");
  assert.equal(notice.screenshots[0].uncertain, true);
  assert.equal(notice.ignored[0].reason, "chat");
  assert.equal(notice.extraction.mode, "cloud_agent");
});

test("review decisions can exclude, defer, or confirm a candidate", () => {
  assert.equal(buildReviewedTask(task(), edits({ selected: false }), "notice-new"), null);
  assert.equal(buildReviewedTask(task(), edits({ relevance: "not_mine" }), "notice-new"), null);

  const later = buildReviewedTask(task(), edits({ relevance: "later", confirmActionable: false }), "notice-new");
  assert.equal(later.category, "needs_confirm");
  assert.equal(later.relevance, "unknown");
  assert.equal(later.reviewed, true);

  const confirmed = buildReviewedTask(task(), edits(), "notice-new");
  assert.equal(confirmed.category, "action");
  assert.equal(confirmed.relevance, "required");
  assert.equal(confirmed.location, "信息楼A312");
  assert.deepEqual(confirmed.materials, ["承诺书", "学生证"]);

  const imageBlocked = buildReviewedTask(
    task({ sourceImageId: "img1", uncertainty: "附件内容看不清，可能还有第二页。" }),
    edits(),
    "notice-new",
  );
  assert.equal(imageBlocked.category, "needs_confirm");

  const noDeadline = buildReviewedTask(task(), edits({ deadline: "" }), "notice-new");
  assert.equal(noDeadline.category, "needs_confirm");
});

test("apply review decisions creates new tasks, patches relations, and stores reminders", () => {
  const existing = [
    task({ id: "old-merge", noticeId: "notice-old", title: "消防演练", materials: [], status: "todo", category: "action" }),
    task({ id: "old-update", noticeId: "notice-old", title: "提交材料", deadline: "2026-11-20", category: "action" }),
  ];
  const incoming = task({ title: "参加宿舍楼下消防演练", deadline: "2026-11-30", location: "宿舍楼下", materials: ["学生证"] });
  const outcome = applyReviewDecisions({
    noticeId: "notice-new",
    existingTasks: existing,
    decisions: [
      { task: incoming, relationChoice: "merge", relationTaskId: "old-merge", reminderAt: "2026-11-29T17:00", reminderLead: "1d" },
      { task: task({ title: "提交材料", deadline: null }), relationChoice: "update", relationTaskId: "old-update", reminderAt: null, reminderLead: "none" },
      { task: incoming, relationChoice: "create_new", relationTaskId: "", reminderAt: "2026-11-26T17:00", reminderLead: "1d" },
      { task: incoming, relationChoice: "skip", relationTaskId: "", reminderAt: null, reminderLead: "none" },
    ],
  });
  assert.equal(outcome.merged, 1);
  assert.equal(outcome.updated, 1);
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.newTasks.length, 1);
  assert.equal(outcome.newTasks[0].noticeId, "notice-new");
  assert.match(outcome.newTasks[0].id, /^task-/);
  assert.equal(outcome.patches["old-merge"].materials.includes("学生证"), true);
  assert.equal(outcome.patches["old-merge"].reviewed, true);
  assert.equal(outcome.patches["old-update"].deadline, null);
  assert.equal(outcome.reminders["old-merge"].at, "2026-11-29T17:00");
  assert.equal(Object.keys(outcome.reminders).length, 2);
});

test("duplicate detection reports changed fields but not a missing incoming location", () => {
  const existing = task({
    id: "old-drill",
    title: "参加宿舍楼下消防演练",
    action: "11月26日晚在宿舍楼下集合参加消防演练，不用带东西。",
    deadline: "2026-11-26",
    deadlineText: "11月26日晚7点",
    location: "宿舍楼下",
    materials: [],
  });
  const incoming = task({
    noticeId: "notice-newer",
    title: "参加宿舍楼下消防演练",
    action: "11月30日晚7点在宿舍楼下集合参加消防演练，请带好学生证。",
    deadline: "2026-11-30",
    deadlineText: "11月30日晚7点",
    location: null,
    materials: ["学生证"],
    sourceQuote: "11月30日晚7点在宿舍楼下集合参加消防演练，请带好学生证。",
  });
  const relation = relateTask(incoming, existing);
  assert.ok(relation);
  assert.equal(relation.task.id, "old-drill");
  assert.equal(relation.kind, "update");
  assert.ok(relation.changed.includes("截止日期"));
  assert.ok(relation.changed.includes("办理要求"));
  assert.ok(relation.changed.includes("材料"));
  assert.equal(relation.changed.includes("地点"), false);
  assert.equal(findTaskRelations(incoming, [existing])[0].task.id, "old-drill");
  assert.equal(updateTaskFrom(existing, { ...incoming, deadline: null }).deadline, null);
});

test("a reviewed task is not reverted by the vague-deadline gate on reload", () => {
  const body = "请尽快提交材料，具体时间另行通知。";
  const base = task({ sourceQuote: "请尽快提交材料", sourceStart: 0, sourceEnd: 8, deadlineText: "尽快", deadline: "2026-12-01", category: "action" });
  const gated = repairExtractedTask(base, body);
  assert.equal(gated.deadline, null);
  assert.equal(gated.category, "needs_confirm");

  const reviewed = repairExtractedTask({ ...base, reviewed: true }, body);
  assert.equal(reviewed.deadline, "2026-12-01");
  assert.equal(reviewed.category, "action");
});

test("screenshot evidence anchors tasks and uncertain reads force needs_confirm", () => {
  const transcript = "请于11月27日17:00前把承诺书交到信息楼A312。";
  const tasks = gateExtractedTasks({
    body: "",
    role: "student",
    noticeId: "notice-image",
    imageReads: [{ imageId: "img1", text: transcript, uncertain: true, notes: "右侧裁切" }],
    tasks: [{
      id: "img-task",
      title: "交承诺书",
      action: "把承诺书交到信息楼A312",
      deadline: "2026-11-27",
      deadlineText: "11月27日17:00前",
      materials: ["承诺书"],
      category: "action",
      sourceQuote: "请于11月27日17:00前把承诺书交到信息楼A312。",
    }],
  });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].sourceImageId, "img1");
  assert.equal(tasks[0].category, "needs_confirm");
  assert.ok(tasks[0].sourceStart !== null);
});

test("reminder leads, repeat suppression, acknowledgement and postponement stay independent", () => {
  const now = new Date(2026, 10, 21, 10, 0);
  assert.equal(defaultReminderLead("2026-11-27", "11月27日17:00前", now), "1d");
  assert.equal(reminderAtFor("2026-11-27", "11月27日17:00前", "1d"), "2026-11-26T17:00");
  assert.equal(reminderAtFor("2026-11-27", "11月27日17:00前", "2h"), "2026-11-27T15:00");
  assert.equal(reminderAtFor(null, null, "1d"), null);
  const choices = postponeChoices(now);
  assert.equal(choices[0].until, "2026-11-21T10:15");
  assert.equal(choices[1].until, "2026-11-21T11:00");

  const drill = task({ id: "drill", deadline: "2026-11-26", deadlineText: "11月26日晚7点", category: "action" });
  const reminder = { at: "2026-11-21T08:00", lead: "1d", notifiedAt: null, acknowledgedAt: null, postponedUntil: null };
  assert.equal(isReminderDue(reminder, drill, now), true);
  assert.equal(shouldNotify(reminder, drill, now), true);
  const notified = { ...reminder, notifiedAt: new Date(now.getTime() - 30 * 60 * 1000).toISOString() };
  assert.equal(shouldNotify(notified, drill, now), false);
  assert.equal(summarizePriority([drill], { drill: notified }, now).reminded.length, 1);

  const acknowledged = acknowledgeReminder(notified, now);
  assert.equal(shouldNotify(acknowledged, drill, now), false);
  assert.equal(summarizePriority([drill], { drill: acknowledged }, now).reminded.length, 0);
  const expiredAck = { ...acknowledged, acknowledgedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(), notifiedAt: null };
  assert.equal(shouldNotify(expiredAck, drill, now), true);

  const postponed = postponeReminder(reminder, "2026-11-21T11:00");
  assert.equal(isReminderDue(postponed, drill, new Date(2026, 10, 21, 10, 30)), false);
  assert.equal(isReminderDue(postponed, drill, new Date(2026, 10, 21, 11, 1)), true);
});

test("image contract accepts only supported data URLs and enforces budgets", async () => {
  const image = await imageFromDataUrl("data:image/png;base64,AAAA", { id: "img1", name: "截图.png" });
  assert.equal(image.mediaType, "image/png");
  assert.equal(image.data, "AAAA");
  assert.equal(imageDataUrl(image), "data:image/png;base64,AAAA");
  await assert.rejects(() => imageFromDataUrl("data:image/gif;base64,AAAA"));
  assert.equal(totalImageChars([image]), 4);
  assert.doesNotThrow(() => assertImageBudget([image]));
  assert.throws(() => assertImageBudget(Array.from({ length: 5 }, () => image)), /最多/);
});

test("judge intro sells the product first and keeps one honest boundary", () => {
  assert.equal(JUDGE_COPY.facts.length, 3);
  assert.equal(TOUR_STEPS.length, 6);
  assert.ok(TOUR_STEPS.every((step) => step.targets.length > 0 && step.title && step.text));
  assert.match(JUDGE_COPY.intro, /面向学生/);
  assert.match(JUDGE_COPY.intro, /不监听微信、QQ 或邮箱/);
  assert.match(JUDGE_COPY.intro, /截图/);
  assert.doesNotMatch(JUDGE_COPY.intro, /Key|Cloud Agent|后台推送/);
  assert.equal(JUDGE_COPY.facts.some((fact) => fact.text.includes("闲聊")), true);
  assert.equal(JUDGE_COPY.facts.some((fact) => fact.text.includes("系统通知")), true);
  assert.match(JUDGE_COPY.boundary, /关闭这个网页后/);
  assert.match(JUDGE_COPY.boundary, /当前浏览器/);
  assert.equal(JUDGE_COPY.boundary.includes("Key"), false);
});

test("system reminder quick test stays about a minute ahead", () => {
  const now = new Date(2026, 10, 21, 13, 47, 55);
  const oneMinute = minuteFromNow(now);
  assert.equal(oneMinute, "2026-11-21T13:49");
  const parsed = new Date(2026, 10, 21, 13, 49);
  assert.ok(parsed.getTime() >= now.getTime() + 60 * 1000);
});