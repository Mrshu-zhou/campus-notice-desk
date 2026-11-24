import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CLASS_NOTICE_ID, seedNotices, seedTasks } from "../src/data.ts";
import { advanceTourStep, applyTourEvent, demoLoadTourEvent, skipOptionalTourStep, TOUR_STEPS } from "../src/lib/judge.ts";
import { emptyIntakeDraft } from "../src/lib/intake.ts";
import { describeImageFailures, extractTasksByImage } from "../src/lib/multi-image-extraction.ts";
import {
  canRequestNotification,
  canSendTestNotification,
  notificationFailureReason,
  notificationStatusLabel,
} from "../src/lib/notifications.ts";
import { defaultReminderLead, formatDateTime, normalizeChineseDateTime, reminderAtFor } from "../src/lib/reminders.ts";
import { buildReviewedTask, defaultCandidateDecision, describeReviewOutcome, partitionMaterials } from "../src/lib/review.ts";
import { emptyState, hydrateRoleState, serializeRoleState } from "../src/lib/storage.ts";
import { pruneRoleState, removeNoticeFromState } from "../src/lib/state-hygiene.ts";
import { countIncompleteTasks, countDoneTasks, summarizeTaskCounts } from "../src/lib/task-counts.ts";
import { clockFromDeadlineText, deadlineSourceNote, extractLinks, formatDeadlineLabel, normalizeClockInput } from "../src/lib/tasks.ts";
import { visibleWorkbenchNotices, visibleWorkbenchTasks } from "../src/lib/workbench-visibility.ts";
import { MOBILE_SECTIONS, mobileSectionForView, sectionAfterSave } from "../src/lib/mobile-nav.ts";
import { computeTourPosition } from "../src/lib/tour-position.ts";

function candidate(overrides = {}) {
  return {
    id: "cand-ux-1",
    noticeId: "notice-ux",
    role: "student",
    title: "参加安全工作例会",
    action: "11月26日下午14:30到行政楼会议室参加安全工作例会",
    deadline: "2026-11-26",
    deadlineText: "11月26日下午14:30",
    materials: ["宿舍查寝记录"],
    category: "action",
    status: "todo",
    sourceQuote: "11月26日下午14:30在行政楼会议室召开安全工作例会",
    sourceStart: 0,
    sourceEnd: 27,
    ...overrides,
  };
}

function edits(overrides = {}) {
  return {
    selected: true,
    title: "参加安全工作例会",
    action: "11月26日下午14:30到行政楼会议室参加安全工作例会",
    deadline: "2026-11-26",
    deadlineText: "11月26日下午14:30",
    deadlineClock: "14:30",
    materialsText: "宿舍查寝记录",
    location: "行政楼会议室",
    requirements: "",
    relevance: "need",
    confirmActionable: false,
    relationChoice: "create_new",
    relationTaskId: "",
    reminderLead: "none",
    customReminderAt: "",
    ...overrides,
  };
}

test("header, board and priority counts use the same visible unfinished tasks", () => {
  const tasks = [
    candidate({ id: "open-1" }),
    candidate({ id: "open-2", category: "needs_confirm", deadline: null, deadlineText: "今天下午" }),
    candidate({ id: "fyi-1", category: "fyi" }),
    candidate({ id: "done-1", status: "done" }),
  ];
  assert.equal(countIncompleteTasks(tasks), 2);
  assert.equal(countDoneTasks(tasks), 1);
  const counts = summarizeTaskCounts(tasks, "2026-11-22");
  assert.equal(counts.total, 4);
  assert.equal(counts.needsConfirm, 1);
  assert.equal(counts.fyi, 1);
});

test("hidden seed notices do not leak ghost tasks into the workbench", () => {
  const ghost = seedTasks.find((task) => task.id === "task-course-check-2");
  assert.ok(ghost);
  const ghostNotice = seedNotices.find((notice) => notice.id === ghost.noticeId);
  assert.ok(ghostNotice);
  assert.notEqual(ghostNotice.id, CLASS_NOTICE_ID);
  const visibleNotices = visibleWorkbenchNotices(seedNotices, "student", true, []);
  const visibleTasks = visibleWorkbenchTasks([ghost], visibleNotices);
  assert.equal(visibleTasks.length, 0);
  assert.equal(visibleNotices.some((notice) => notice.id === ghost.noticeId), false);
});

test("stale local task references are pruned before they reach counts", () => {
  const state = emptyState();
  state.customNotices = [
    { id: "notice-keep", role: "student", sourceType: "paste", sourceLabel: "粘贴导入", title: "保留", body: "正文", receivedAt: "2026-11-22T08:00:00.000Z", read: false, adapter: "paste_import" },
    { id: "notice-other-role", role: "counselor", sourceType: "email", sourceLabel: "邮件", title: "别的角色", body: "正文", receivedAt: "2026-11-22T08:00:00.000Z", read: false, adapter: "paste_import" },
    { id: "notice-orphan", role: "student", sourceType: "paste", sourceLabel: "粘贴导入", title: "引用已丢失", body: "正文", receivedAt: "2026-11-22T08:00:00.000Z", read: false, adapter: "paste_import" },
  ];
  state.customTasks = [
    candidate({ id: "task-keep", noticeId: "notice-keep" }),
    candidate({ id: "task-other-role", noticeId: "notice-keep", role: "counselor" }),
    candidate({ id: "task-missing-notice", noticeId: "notice-missing" }),
  ];
  state.read = { "notice-keep": true, "notice-orphan": true, "notice-missing": true };
  state.done = { "task-keep": true, "task-missing-notice": true };
  state.reminders = {
    "task-keep": { at: "2026-11-25T14:30", lead: "1d" },
    "task-missing-notice": { at: "2026-11-25T14:30", lead: "1d" },
  };
  const pruned = pruneRoleState(state, {
    role: "student",
    seedNoticeIds: seedNotices.filter((notice) => notice.role === "student").map((notice) => notice.id),
    seedTaskIds: seedTasks.filter((task) => task.role === "student").map((task) => task.id),
  });
  assert.deepEqual(pruned.customTasks.map((task) => task.id), ["task-keep"]);
  assert.deepEqual(pruned.customNotices.map((notice) => notice.id), ["notice-keep", "notice-orphan"]);
  assert.equal(pruned.read["notice-missing"], undefined);
  assert.equal(pruned.done["task-missing-notice"], undefined);
  assert.equal(pruned.reminders["task-missing-notice"], undefined);
});

test("fyi candidates default to not adding a todo", () => {
  const fyi = candidate({ category: "fyi", deadline: null, deadlineText: null });
  assert.deepEqual(defaultCandidateDecision(fyi), { selected: false, relevance: "not_mine" });
  assert.equal(buildReviewedTask(fyi, edits({ selected: false, relevance: "not_mine" }), "notice-ux"), null);
  assert.equal(buildReviewedTask(fyi, edits({ relevance: "later", selected: true }), "notice-ux"), null);
  const explicit = buildReviewedTask(fyi, edits({ relevance: "need", selected: true }), "notice-ux");
  assert.ok(explicit);
  assert.equal(explicit.category, "action");
});

test("needs-confirm candidates always default to later, even without a relevance label", () => {
  assert.deepEqual(
    defaultCandidateDecision(candidate({ category: "needs_confirm", relevance: "required" })),
    { selected: true, relevance: "later" },
  );
  assert.deepEqual(
    defaultCandidateDecision(candidate({ category: "needs_confirm", relevance: undefined })),
    { selected: true, relevance: "later" },
  );
  assert.deepEqual(
    defaultCandidateDecision(candidate({ category: "action", relevance: undefined })),
    { selected: true, relevance: "need" },
  );
  assert.deepEqual(
    defaultCandidateDecision(candidate({ category: "action", relevance: "later" })),
    { selected: true, relevance: "need" },
  );
});

test("deleting a custom notice clears its local todos, reminders and patches", () => {
  const state = emptyState();
  state.customNotices = [
    { id: "notice-custom", role: "student", sourceType: "paste", sourceLabel: "粘贴导入", title: "待删除", body: "正文", receivedAt: "2026-11-22T08:00:00.000Z", read: false, adapter: "paste_import" },
    { id: "notice-other", role: "student", sourceType: "paste", sourceLabel: "粘贴导入", title: "保留", body: "正文", receivedAt: "2026-11-22T08:00:00.000Z", read: false, adapter: "paste_import" },
  ];
  state.customTasks = [
    candidate({ id: "task-custom", noticeId: "notice-custom" }),
    candidate({ id: "task-other", noticeId: "notice-other" }),
  ];
  state.read = { "notice-custom": true, "notice-other": true };
  state.done = { "task-custom": true, "task-other": true };
  state.deadlines = { "task-custom": "2026-11-26", "task-other": "2026-11-27" };
  state.reminders = {
    "task-custom": { at: "2026-11-25T14:30", lead: "1d" },
    "task-other": { at: "2026-11-26T14:30", lead: "1d" },
  };
  state.taskPatches = { "task-custom": { title: "改过" }, "task-other": { title: "保留" } };

  const next = removeNoticeFromState(state, "notice-custom");
  assert.deepEqual(next.customNotices.map((notice) => notice.id), ["notice-other"]);
  assert.deepEqual(next.customTasks.map((task) => task.id), ["task-other"]);
  assert.equal(next.read["notice-custom"], undefined);
  assert.equal(next.done["task-custom"], undefined);
  assert.equal(next.deadlines["task-custom"], undefined);
  assert.equal(next.reminders["task-custom"], undefined);
  assert.equal(next.taskPatches["task-custom"], undefined);
  assert.equal(next.done["task-other"], true);
  assert.deepEqual(next.hiddenNoticeIds, []);
});

test("deleting a seed notice hides it across reloads and removes ghost todos", () => {
  const ghost = seedTasks.find((task) => task.id === "task-course-check-2");
  assert.ok(ghost);
  const notice = seedNotices.find((item) => item.id === ghost.noticeId);
  assert.ok(notice);
  const state = emptyState();
  state.read[notice.id] = true;
  state.done[ghost.id] = true;
  state.deadlines[ghost.id] = "2026-11-27";
  state.reminders[ghost.id] = { at: "2026-11-26T09:00", lead: "1d" };
  state.taskPatches[ghost.id] = { title: "旧标题" };

  const next = removeNoticeFromState(state, notice.id, { hideSeedNotice: true, extraTaskIds: [ghost.id] });
  assert.deepEqual(next.hiddenNoticeIds, [notice.id]);
  assert.equal(next.read[notice.id], undefined);
  assert.equal(next.done[ghost.id], undefined);
  assert.equal(next.reminders[ghost.id], undefined);
  assert.equal(next.taskPatches[ghost.id], undefined);

  const hydrated = hydrateRoleState(serializeRoleState(next));
  assert.deepEqual(hydrated.hiddenNoticeIds, [notice.id]);
  const visible = visibleWorkbenchNotices(seedNotices, "student", true, [notice.id])
    .filter((item) => !hydrated.hiddenNoticeIds.includes(item.id));
  assert.equal(visible.some((item) => item.id === notice.id), false);
  assert.equal(visibleWorkbenchTasks(seedTasks.filter((task) => task.noticeId === notice.id), visible).length, 0);
});

test("legacy saved state without hiddenNoticeIds hydrates to an empty hidden list", () => {
  const legacy = JSON.stringify({
    read: {},
    done: {},
    deadlines: {},
    customNotices: [],
    customTasks: [],
    reminders: {},
    taskPatches: {},
  });
  assert.deepEqual(hydrateRoleState(legacy).hiddenNoticeIds, []);
});

test("batch screenshots keep successful results when one image times out", async () => {
  const request = {
    role: "student",
    today: "2026-11-22",
    sourceType: "wechat_group",
    body: "班级群通知",
    images: [
      { id: "img1", mediaType: "image/png", data: "AAAA" },
      { id: "img2", mediaType: "image/png", data: "BBBB" },
      { id: "img3", mediaType: "image/png", data: "CCCC" },
    ],
  };
  const calls = [];
  const fakeExtract = async (unit) => {
    calls.push(unit);
    if (unit.images[0]?.id === "img2") throw new Error("拆解服务没有返回可用结果（HTTP 504）");
    const imageId = unit.images[0]?.id ?? null;
    return {
      mode: "cloud_agent",
      tasks: [candidate({ id: `task-${imageId ?? "text"}`, noticeId: "notice-batch", sourceImageId: imageId ?? undefined })],
      imageReads: unit.images.map((image) => ({ imageId: image.id, text: `读图 ${image.id}`, uncertain: false, notes: "" })),
      ignored: [],
      trace: { requestMs: 10, gateMs: 2, returnedTasks: 1, acceptedTasks: 1, imageCount: unit.images.length },
    };
  };

  const result = await extractTasksByImage(request, { imageLabels: { img2: "实验室安全.png" } }, fakeExtract);
  assert.equal(calls.length, 4, "one text request plus one request per screenshot");
  assert.equal(calls.filter((unit) => unit.images.length === 0).length, 1);
  assert.equal(result.imageFailures.length, 1);
  assert.match(result.imageFailures[0].label, /实验室安全/);
  assert.equal(result.tasks.length, 3);
  const failureCopy = describeImageFailures(result.imageFailures);
  assert.match(failureCopy, /一张一张/);
  assert.match(failureCopy, /草稿/);
  assert.match(failureCopy, /超时/);
});

test("batch screenshots report all failures without inventing a result", async () => {
  const request = {
    role: "student",
    today: "2026-11-22",
    sourceType: "wechat_group",
    body: "班级群通知",
    images: [
      { id: "img1", mediaType: "image/png", data: "AAAA" },
      { id: "img2", mediaType: "image/png", data: "BBBB" },
    ],
  };
  await assert.rejects(
    () => extractTasksByImage(request, {}, async () => { throw new Error("HTTP 504"); }),
    /一张一张/,
  );
});

test("single screenshot keeps the existing one-request path", async () => {
  const request = {
    role: "student",
    today: "2026-11-22",
    sourceType: "wechat_group",
    body: "",
    images: [{ id: "img1", mediaType: "image/png", data: "AAAA" }],
  };
  const calls = [];
  const fakeExtract = async (unit) => {
    calls.push(unit);
    return {
      mode: "cloud_agent",
      tasks: [],
      imageReads: [],
      ignored: [],
      trace: { requestMs: 1, gateMs: 1, returnedTasks: 0, acceptedTasks: 0, imageCount: unit.images.length },
    };
  };
  const result = await extractTasksByImage(request, {}, fakeExtract);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].images.map((image) => image.id), ["img1"]);
  assert.deepEqual(result.imageFailures, []);
});

test("tour starts at step one and advances with real actions", () => {
  assert.equal(TOUR_STEPS[0].id, "intake");
  assert.equal(TOUR_STEPS[0].targets[0], '[data-tour="intake-heading"]');
  assert.equal(TOUR_STEPS[0].advanceOn, "draft-ready");
  assert.equal(TOUR_STEPS[0].text.includes("左侧左列"), false);
  assert.match(TOUR_STEPS[5].text, /通知列表/);
  assert.match(TOUR_STEPS[5].text, /看板/);
  assert.match(TOUR_STEPS[5].text, /草稿.*清空/);
  assert.equal(TOUR_STEPS[5].text.includes("左侧左列"), false);
  assert.equal(advanceTourStep(0, "draft-ready"), 1);
  assert.equal(advanceTourStep(1, "review-open"), 2);
  assert.equal(advanceTourStep(2, "decision"), 3);
  assert.equal(advanceTourStep(3, "relation-choice"), 4);
  assert.equal(advanceTourStep(4, "saved"), 5);
  assert.equal(advanceTourStep(0, "review-open"), null);
  assert.equal(skipOptionalTourStep(3), 4);
  assert.equal(skipOptionalTourStep(1), null);
});

test("auto demo load stays at 1/6 and review-open reaches the review step", () => {
  let step = 0;
  const autoEvent = demoLoadTourEvent("auto");
  if (autoEvent) step = applyTourEvent(step, autoEvent);
  assert.equal(step, 0, "auto-loading the demo screenshot must not consume draft-ready");
  assert.equal(demoLoadTourEvent("manual"), "draft-ready");
  step = applyTourEvent(step, "draft-ready");
  assert.equal(step, 1);
  step = applyTourEvent(step, "review-open");
  assert.equal(step, 2);
  assert.equal(TOUR_STEPS[2].id, "review");
  assert.equal(applyTourEvent(0, "review-open"), 2);
  assert.equal(applyTourEvent(2, "review-open"), 2, "a repeated review-open must not exit the tour");
  assert.equal(applyTourEvent(4, "review-open"), 4);
  assert.equal(applyTourEvent(null, "review-open"), null, "an exited tour must not be revived");
});

test("unconsumed tour events keep the current step so the coach stays mounted", () => {
  // Real submit from 2/6 emits draft-ready before review-open; that must not null out the step.
  const afterDraftReady = applyTourEvent(1, "draft-ready");
  assert.notEqual(afterDraftReady, null);
  assert.equal(afterDraftReady, 1);
  assert.equal(applyTourEvent(afterDraftReady, "review-open"), 2);

  let step = 1;
  step = applyTourEvent(step, "draft-ready");
  step = applyTourEvent(step, "review-open");
  assert.equal(step, 2, "clicking 整理这批通知 at 2/6 lands on 3/6");

  // Submitting directly from 1/6 consumes draft-ready first, then review-open.
  let fresh = 0;
  fresh = applyTourEvent(fresh, "draft-ready");
  assert.equal(fresh, 1);
  fresh = applyTourEvent(fresh, "review-open");
  assert.equal(fresh, 2, "submitting directly from 1/6 also lands on 3/6");

  // Other out-of-order events keep the coach instead of unloading it.
  assert.equal(applyTourEvent(2, "draft-ready"), 2);
  assert.equal(applyTourEvent(1, "decision"), 1);
  assert.equal(applyTourEvent(5, "saved"), 5);
});

test("saving clears the draft and reports the same outcome as the toast", () => {
  assert.deepEqual(emptyIntakeDraft(), { segments: [], pending: "", images: [] });
  const outcome = {
    newTasks: [candidate({ id: "n1" }), candidate({ id: "n2" }), candidate({ id: "n3" })],
    patches: {},
    reminders: {},
    skipped: 1,
    merged: 0,
    updated: 0,
  };
  assert.equal(describeReviewOutcome(outcome, 0), "新增 3 条，跳过 1 条");
  assert.equal(describeReviewOutcome({ ...outcome, newTasks: [] }, 0), "跳过 1 条");
});

test("relative source time, activity labels and Chinese reminder time stay Chinese", () => {
  assert.equal(deadlineSourceNote(null, "今天下午"), "原文：今天下午；具体日期待确认");
  assert.match(formatDeadlineLabel("2026-11-26", "11月26日下午14:30", null, "参加安全工作例会"), /^开始 11月26日 14:30$/);
  assert.match(formatDeadlineLabel("2026-11-27", "11月27日17:00前", null, "提交实验室安全承诺书"), /^截止 11月27日 17:00$/);
  assert.equal(normalizeClockInput("14：30"), "14:30");
  assert.equal(normalizeClockInput("25:00"), null);
  assert.equal(clockFromDeadlineText("11月26日下午2:30"), "14:30");
  assert.equal(clockFromDeadlineText("11月26日晚上8:00"), "20:00");
  assert.equal(normalizeChineseDateTime("2026-11-22", "9", "5"), "2026-11-22T09:05");
  assert.equal(formatDateTime("2026-11-22T10:57"), "2026年11月22日 10:57");
  assert.equal(formatDateTime("2026-11-22T10:57").includes("AM"), false);
  assert.equal(reminderAtFor("2026-11-26", "11月26日下午14:30", "1d", "", "14:30"), "2026-11-25T14:30");
  assert.equal(defaultReminderLead("2026-11-26", "11月26日下午14:30", new Date(2026, 10, 22, 9, 0), "14:30"), "1d");
});

test("credentials leave materials and login notes are kept as requirements", () => {
  const parts = partitionMaterials(["学生证", "学号 20230001", "初始密码 abc12345", "VPN 登录说明"]);
  assert.deepEqual(parts.materials, ["学生证"]);
  assert.equal(parts.loginNotes.length, 3);
  const built = buildReviewedTask(candidate({ materials: ["学生证", "学号 20230001"] }), edits({ materialsText: "学生证、学号 20230001" }), "notice-ux");
  assert.ok(built);
  assert.deepEqual(built.materials, ["学生证"]);
  assert.match(built.requirements ?? "", /学号 20230001/);
});

test("mobile navigation exposes three clear sections and lands on tasks after save", () => {
  assert.deepEqual(MOBILE_SECTIONS.map((section) => section.id), ["intake", "tasks", "source"]);
  assert.deepEqual(MOBILE_SECTIONS.map((section) => section.label), ["添加通知", "待办", "原文依据"]);
  assert.ok(MOBILE_SECTIONS.every((section) => section.hint.length > 0));
  assert.equal(sectionAfterSave(), "tasks");
  assert.equal(mobileSectionForView("board", "source"), "tasks");
  assert.equal(mobileSectionForView("workbench", "source"), "source");
});

test("mobile notice switcher exposes an independent delete entry", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const switcherStart = app.indexOf('className="mobile-notice-switcher"');
  assert.ok(switcherStart > -1, "mobile notice switcher must exist");
  const head = app.slice(switcherStart, app.indexOf("mobile-notice-chips", switcherStart));
  assert.match(head, /删除这条通知/);
  const deleteButton = head.slice(
    head.indexOf('className="text-button mobile-notice-delete"'),
    head.indexOf("</button>", head.indexOf('className="text-button mobile-notice-delete"')),
  );
  assert.match(deleteButton, /event\.stopPropagation\(\)/);
  assert.match(deleteButton, /setDeleteTarget\(currentNotice\)/);
  assert.equal(deleteButton.includes("selectNotice"), false, "delete must not switch the selected notice");
});

test("tour coach stays inside the mobile viewport above bottom bars and the Qoder badge", () => {
  const viewport = { width: 360, height: 640, mobile: true };
  const bubble = { width: 340, height: 220 };
  const rects = [
    { top: 548, left: 12, right: 348, bottom: 596, width: 336, height: 48 },
    { top: 140, left: 10, right: 350, bottom: 600, width: 340, height: 460 },
    { top: 84, left: 20, right: 340, bottom: 200, width: 320, height: 116 },
  ];
  for (const rect of rects) {
    const position = computeTourPosition(rect, viewport, bubble);
    assert.ok(position.left >= 12, "bubble must stay inside the left edge");
    assert.ok(position.left + position.width <= viewport.width - 12, "bubble must stay inside the right edge");
    assert.ok(position.top >= 64, "bubble must clear the sticky section tabs");
    assert.ok(position.top + bubble.height <= viewport.height - 128, "bubble must clear the bottom bar and badge");
  }
});

test("desktop tour coach keeps clear of the platform badge", () => {
  const viewport = { width: 1280, height: 800, mobile: false };
  const bubble = { width: 340, height: 250 };
  const rect = { top: 640, left: 760, right: 1040, bottom: 700, width: 280, height: 60 };
  const position = computeTourPosition(rect, viewport, bubble);
  assert.ok(position.left >= 16);
  assert.ok(position.left + position.width <= viewport.width - 16);
  assert.ok(position.top >= 16);
  assert.ok(position.top + bubble.height <= viewport.height - 76);
  assert.equal(overlapsTarget(position, bubble, rect), false, "bubble must not cover its own target");
});

function coachBox(position, bubble) {
  return {
    top: position.top,
    left: position.left,
    right: position.left + position.width,
    bottom: position.top + bubble.height,
    width: position.width,
    height: bubble.height,
  };
}

function overlapsTarget(position, bubble, rect) {
  const box = coachBox(position, bubble);
  return box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
}

function assertDesktopCoachClear(position, viewport, bubble, obstacles) {
  const box = coachBox(position, bubble);
  assert.ok(box.left >= 16, "bubble must stay inside the left edge");
  assert.ok(box.right <= viewport.width - 16, "bubble must stay inside the right edge");
  assert.ok(box.top >= 16, "bubble must stay below the top edge");
  assert.ok(box.bottom <= viewport.height - 76, "bubble must clear the platform badge");
  for (const obstacle of obstacles) {
    assert.equal(overlapsTarget(position, bubble, obstacle), false, "bubble must not cover a primary action or error text");
  }
}

test("desktop tour coach keeps clear of submit/save buttons and the intake error banner", () => {
  const viewport = { width: 1280, height: 800, mobile: false };
  const bubble = { width: 340, height: 250 };
  // Bottom-right primary action "整理这批通知" and the full-width error above it.
  const submit = { top: 708, left: 1120, right: 1246, bottom: 744, width: 126, height: 36 };
  const error = { top: 662, left: 936, right: 1258, bottom: 694, width: 322, height: 32 };
  const save = { top: 700, left: 1108, right: 1240, bottom: 734, width: 132, height: 34 };

  const plain = computeTourPosition(submit, viewport, bubble);
  assertDesktopCoachClear(plain, viewport, bubble, [submit]);

  const withError = computeTourPosition(submit, viewport, bubble, [error]);
  assertDesktopCoachClear(withError, viewport, bubble, [submit, error]);

  const saveTarget = computeTourPosition(save, viewport, bubble, [submit]);
  assertDesktopCoachClear(saveTarget, viewport, bubble, [save, submit]);

  const saveWithError = computeTourPosition(save, viewport, bubble, [submit, error]);
  assertDesktopCoachClear(saveWithError, viewport, bubble, [save, submit, error]);
});

test("action links are extracted and notification states stay explicit", () => {
  const links = extractLinks("请到 https://example.edu/survey/42 评价", "见 https://example.edu/survey/42");
  assert.deepEqual(links, ["https://example.edu/survey/42"]);
  const residual = "请登录 https://newtqe.neusoft.edu.cn（或通过企业微信—工作台—“教学质量评价”模块）完成评价。";
  assert.deepEqual(extractLinks(residual), ["https://newtqe.neusoft.edu.cn"]);
  assert.equal(extractLinks(residual)[0].includes("或通过"), false);
  assert.deepEqual(extractLinks("报名见 https://example.edu/a?x=1。下一句"), ["https://example.edu/a?x=1"]);
  assert.deepEqual(extractLinks("链接「https://example.edu/notice」和 https://example.edu/b）"), ["https://example.edu/notice", "https://example.edu/b"]);
  assert.equal(notificationStatusLabel("default"), "未授权");
  assert.equal(notificationStatusLabel("granted"), "已允许");
  assert.equal(notificationStatusLabel("denied"), "已拒绝");
  assert.equal(notificationStatusLabel("unsupported"), "当前浏览器不支持");
  assert.equal(canRequestNotification("default"), true);
  assert.equal(canRequestNotification("denied"), false);
  assert.equal(canSendTestNotification("granted"), true);
  assert.equal(canSendTestNotification("default"), false);
  assert.match(notificationFailureReason("denied"), /拒绝/);
});