import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRoleState } from "../src/lib/tasks.ts";
import { applyDeadlineGate, detectClarification, gateExtractedTasks, isContinuousQuote, isVagueDeadlineText, resolveSourceQuote, shouldDropAsNonAction } from "../src/lib/gates.ts";
import { hydrateRoleState, roleStorageKey, serializeRoleState } from "../src/lib/storage.ts";
import { originCaption, parseExtractionMode } from "../src/lib/extraction-mode.ts";
import { isStudentWorkbenchNotice, visibleWorkbenchNotices, visibleWorkbenchTasks } from "../src/lib/workbench-visibility.ts";
import { formatTaskCountLabel, summarizeTaskCounts } from "../src/lib/task-counts.ts";

const notices = JSON.parse(readFileSync(new URL("../data/sample-notices.json", import.meta.url), "utf8"));
const expected = JSON.parse(readFileSync(new URL("../data/expected-tasks.json", import.meta.url), "utf8"));
const classNotice = notices.notices.find((notice) => notice.id === "stu-wechat-class-forward");
const labNotice = notices.notices.find((notice) => notice.id === "stu-ambiguous-lab-report");
const studentSample = notices.pasteSamples.find((sample) => sample.id === "paste-demo-student");

function byId(id) {
  return expected.tasks.find((task) => task.id === id);
}

// P0: persisted demoComplete must not skip first-screen idle on reload.
const persisted = serializeRoleState({
  read: { "stu-wechat-class-forward": true },
  done: { "task-class-forward-2": true },
  deadlines: {},
  customNotices: [],
  customTasks: [],
  demoComplete: true,
  tourDismissed: true,
});
const hydrated = hydrateRoleState(persisted);
assert.equal(hydrated.demoComplete, false);
assert.equal(hydrated.read["stu-wechat-class-forward"], true);
assert.equal(hydrated.done["task-class-forward-2"], true);
assert.equal(roleStorageKey("student"), "notice-desk:v1:student");
assert.equal(roleStorageKey("counselor"), "notice-desk:v1:counselor");
assert.equal(serializeRoleState({ ...hydrated, demoComplete: true }).includes('"demoComplete":true'), false);

// applyRoleState must not flip needs_confirm to action just because a deadline exists.
const confirmed = byId("task-class-forward-1");
const withDate = applyRoleState([{ ...confirmed, deadline: "2026-11-21" }], { read: {}, done: {}, deadlines: {}, customNotices: [], customTasks: [], demoComplete: false, tourDismissed: false });
assert.equal(withDate[0].category, "needs_confirm");
assert.equal(withDate[0].deadline, "2026-11-21");
const volunteer = applyRoleState([byId("task-class-forward-2")], { read: {}, done: { "task-class-forward-2": true }, deadlines: {}, customNotices: [], customTasks: [], demoComplete: false, tourDismissed: false });
assert.equal(volunteer[0].category, "action");
assert.equal(volunteer[0].status, "done");
assert.equal(volunteer[0].deadline, "2026-11-25");

// P0: class-forward gates keep exactly 3 tasks; doNotExtract and follow-ups do not create cards.
const classTasks = gateExtractedTasks({
  body: classNotice.body,
  role: "student",
  noticeId: classNotice.id,
  tasks: expected.tasks.filter((task) => task.noticeId === classNotice.id),
  doNotExtract: classNotice.doNotExtract,
  origin: "verified_offline",
});
assert.equal(classTasks.length, 3);
assert.deepEqual(classTasks.map((task) => task.id), ["task-class-forward-1", "task-class-forward-2", "task-class-forward-3"]);
const forward1 = classTasks.find((task) => task.id === "task-class-forward-1");
assert.equal(forward1.deadline, null);
assert.equal(forward1.category, "needs_confirm");
assert.ok(classNotice.body.includes(forward1.sourceQuote));

const withNoise = gateExtractedTasks({
  body: classNotice.body,
  role: "student",
  noticeId: classNotice.id,
  doNotExtract: classNotice.doNotExtract,
  origin: "verified_offline",
  tasks: [
    ...expected.tasks.filter((task) => task.noticeId === classNotice.id),
    { id: "noise-dinner", title: "晚上去二食堂吃饭", action: "先吃饭，我在二食堂门口等你", deadline: "2026-11-19", deadlineText: "今晚", materials: [], category: "action", sourceQuote: "先吃饭，我在二食堂门口等你" },
    { id: "noise-notes", title: "看课堂笔记", action: "二叉树笔记不是作业，需要的自取", deadline: null, deadlineText: null, materials: ["11-19课堂笔记"], category: "action", sourceQuote: "这个不是作业，就是给还没弄懂的同学看的，需要的自取。" },
    { id: "noise-ack", title: "收到", action: "收到", deadline: null, deadlineText: null, materials: [], category: "action", sourceQuote: "收到" },
    { id: "noise-file", title: "报名表在哪个群文件", action: "追问报名表是群文件哪个", deadline: null, deadlineText: null, materials: ["置顶文件"], category: "action", sourceQuote: "报名表是群文件哪个？我怎么只看到上次运动会的" },
    { id: "noise-force", title: "志愿者是否强制", action: "追问是不是强制", deadline: null, deadlineText: null, materials: [], category: "action", sourceQuote: "班长志愿者那项是强制的吗" },
  ],
});
assert.equal(withNoise.length, 3);
assert.ok(!withNoise.some((task) => /吃饭|课堂笔记|收到|哪个群文件|是否强制/.test(task.title)));
assert.ok(withNoise.find((task) => task.id === "task-class-forward-1").materials.includes("置顶文件"));
assert.equal(detectClarification({ title: "报名表是群文件哪个", action: "追问", sourceQuote: "报名表是群文件哪个？" }), "file");

// Invented deadline on vague text must be cleared.
assert.equal(isVagueDeadlineText("辅导员原话是「尽快，最好这周」"), true);
const invented = applyDeadlineGate({
  ...forward1,
  deadline: "2026-11-21",
  deadlineText: "辅导员原话是「尽快，最好这周」；班委也不确定是这周五还是下周五",
  category: "action",
});
assert.equal(invented.deadline, null);
assert.equal(invented.category, "needs_confirm");

// lab-report stays null + needs_confirm; chat around it is dropped.
const labExpected = expected.tasks.find((task) => task.id === "task-lab-report-1");
const labTasks = gateExtractedTasks({
  body: labNotice.body,
  role: "student",
  noticeId: labNotice.id,
  doNotExtract: labNotice.doNotExtract,
  tasks: [
    labExpected,
    { id: "noise-lab-dinner", title: "晚饭还是老地方", action: "走，晚饭还是老地方", deadline: "2026-11-19", deadlineText: "晚饭", materials: [], category: "action", sourceQuote: "走，晚饭还是老地方" },
  ],
});
assert.equal(labTasks.length, 1);
assert.equal(labTasks[0].id, "task-lab-report-1");
assert.equal(labTasks[0].deadline, null);
assert.equal(labTasks[0].category, "needs_confirm");

// Quote must be a continuous span or the task is flagged, not given a fabricated quote.
const badQuote = gateExtractedTasks({
  body: classNotice.body,
  role: "student",
  noticeId: classNotice.id,
  tasks: [{ ...forward1, sourceQuote: "这段文字并不在原文中", category: "action", deadline: "2026-11-21" }],
});
assert.equal(badQuote[0].sourceStart, null);
assert.equal(badQuote[0].category, "needs_confirm");

// Paste sample: keep the CET-4 item, drop dinner and notes; unresolved deadline stays needs_confirm.
const pasteTasks = gateExtractedTasks({
  body: studentSample.body,
  role: "student",
  noticeId: "paste-demo",
  doNotExtract: studentSample.doNotExtract,
  origin: "local_fixture",
  tasks: [
    { id: "cet4", title: "英语四级报名", action: "今晚12点前在教务处网站考试报名上传一寸白底证件照，文件名用学号", deadline: null, deadlineText: "今晚12点截止", materials: ["一寸白底证件照"], category: "action", sourceQuote: "英语四级报名今晚12点截止，系统在教务处网站「考试报名」。要上传一寸白底证件照，文件名用学号。" },
    { id: "dinner", title: "晚上食堂约饭", action: "晚上食堂吗，我饿了", deadline: null, deadlineText: "晚上", materials: [], category: "action", sourceQuote: "晚上食堂吗，我饿了" },
    { id: "notes", title: "高数笔记分享", action: "高数笔记我传群文件了，不是作业，要的自取", deadline: null, deadlineText: null, materials: [], category: "action", sourceQuote: "高数笔记我传群文件了，不是作业，要的自取" },
  ],
});
assert.equal(pasteTasks.length, 1);
assert.equal(pasteTasks[0].id, "cet4");
assert.equal(pasteTasks[0].category, "needs_confirm");
assert.equal(pasteTasks[0].origin, "local_fixture");
assert.notEqual(pasteTasks[0].origin, "cloud_agent");
assert.notEqual(pasteTasks[0].origin, "cloud_agent");
assert.equal(shouldDropAsNonAction({ title: "晚上食堂吗", action: "约饭", sourceQuote: "晚上食堂吗，我饿了" }), true);

// Read and done stay independent in hydrated state after refresh simulation.
assert.equal(hydrated.read["stu-wechat-class-forward"] && hydrated.done["task-class-forward-2"] && !hydrated.demoComplete, true);


// Mode labels keep fixture and offline results distinct from the live QCA path.
assert.equal(parseExtractionMode("cloud_agent"), "cloud_agent");
assert.equal(parseExtractionMode("online"), "cloud_agent");
assert.equal(parseExtractionMode("qwen"), "cloud_agent");
assert.equal(parseExtractionMode("local_fixture"), "local_fixture");
assert.equal(parseExtractionMode("verified_offline"), "verified_offline");
assert.equal(parseExtractionMode("something_else"), null);
assert.equal(originCaption("cloud_agent"), "Cloud Agent 在线拆解");
assert.equal(originCaption("local_fixture"), "本地核对样例，未调用 Cloud Agent");
assert.equal(originCaption("verified_offline"), "离线已核对，未调用 Cloud Agent");

const onlineGated = gateExtractedTasks({
  body: classNotice.body,
  role: "student",
  noticeId: classNotice.id,
  tasks: expected.tasks.filter((task) => task.noticeId === classNotice.id),
  doNotExtract: classNotice.doNotExtract,
  origin: "cloud_agent",
});
assert.equal(onlineGated.length, 3);
assert.equal(onlineGated[0].origin, "cloud_agent");
assert.equal(onlineGated.find((task) => task.id === "task-class-forward-1").category, "needs_confirm");
assert.equal(onlineGated.find((task) => task.id === "task-class-forward-1").deadline, null);


// Whitespace-normalized quotes must snap back to a continuous original span, not a fabricated one.
const spacedQuote = gateExtractedTasks({
  body: classNotice.body,
  role: "student",
  noticeId: classNotice.id,
  tasks: [{ ...forward1, sourceQuote: forward1.sourceQuote.replace(/\s+/g, "  ") }],
});
assert.equal(spacedQuote[0].sourceStart !== null, true);
assert.equal(classNotice.body.includes(spacedQuote[0].sourceQuote), true);
assert.equal(spacedQuote[0].sourceQuote.includes(forward1.sourceQuote.trim()) || forward1.sourceQuote.includes(spacedQuote[0].sourceQuote.trim()), true);

// First-screen workbench stays empty until the mock class notice arrives or a session paste is imported.
assert.equal(isStudentWorkbenchNotice("stu-wechat-class-forward", false, []), false);
assert.equal(isStudentWorkbenchNotice("stu-wechat-class-forward", true, []), true);
assert.equal(isStudentWorkbenchNotice("paste-from-session", false, ["paste-from-session"]), true);
assert.equal(isStudentWorkbenchNotice("stu-ambiguous-lab-report", false, []), false);
assert.equal(isStudentWorkbenchNotice("stu-ambiguous-lab-report", true, []), false);
const studentNotices = notices.notices.filter((notice) => notice.role === "student");
assert.equal(visibleWorkbenchNotices(studentNotices, "student", false, []).length, 0);
assert.deepEqual(visibleWorkbenchNotices(studentNotices, "student", true, []).map((notice) => notice.id), ["stu-wechat-class-forward"]);
const counselorVisible = visibleWorkbenchNotices(notices.notices, "counselor", true, []);
assert.ok(counselorVisible.every((notice) => notice.role === "counselor"));
assert.ok(counselorVisible.length >= 1);
assert.equal(visibleWorkbenchTasks(expected.tasks, []).length, 0);


// Non-adjacent excerpts joined by ellipsis must not be kept as one continuous quote.
const laterQuote = classTasks.find((task) => task.id === "task-class-forward-1").sourceQuote;
const earlierQuote = classTasks.find((task) => task.id === "task-class-forward-2").sourceQuote;
const splicedQuote = `${laterQuote}……对了普通话那个表，${earlierQuote}`;
const spliced = gateExtractedTasks({
  body: classNotice.body,
  role: "student",
  noticeId: classNotice.id,
  tasks: [{ ...forward1, id: "spliced-putonghua", sourceQuote: splicedQuote, category: "action", deadline: "2026-11-21" }],
});
assert.equal(spliced.length, 1);
assert.equal(spliced[0].category, "needs_confirm");
assert.ok(spliced[0].sourceStart !== null && spliced[0].sourceEnd !== null);
assert.equal(classNotice.body.slice(spliced[0].sourceStart, spliced[0].sourceEnd), spliced[0].sourceQuote);
assert.equal(classNotice.body.includes(spliced[0].sourceQuote), true);
assert.equal(spliced[0].sourceQuote.includes("…") || spliced[0].sourceQuote.includes("..."), false);
assert.equal(spliced[0].sourceQuote.includes(laterQuote) && spliced[0].sourceQuote.includes(earlierQuote), false);
assert.equal(isContinuousQuote(classNotice.body, splicedQuote), false);
const resolvedSplice = resolveSourceQuote(classNotice.body, splicedQuote);
assert.equal(resolvedSplice.spliced, true);

// Top-bar counts must match the visible list, including 待确认 and 仅阅知.
const visibleList = [
  { ...forward1, category: "needs_confirm", status: "todo" },
  { ...byId("task-class-forward-2"), category: "needs_confirm", status: "todo" },
  { ...byId("task-lab-report-1"), category: "fyi", status: "todo" },
];
const listCounts = summarizeTaskCounts(visibleList, "2026-11-20");
assert.equal(listCounts.total, 3);
assert.equal(listCounts.needsConfirm, 2);
assert.equal(listCounts.fyi, 1);
assert.equal(formatTaskCountLabel(listCounts), "3 件 · 2 件待确认 · 1 件仅阅知");
assert.notEqual(formatTaskCountLabel(listCounts), "2 件 · 1 件待确认");

console.log("通过：主流程门闸与状态隔离测试（内部验证，不是官方赛分）。");



