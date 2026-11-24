import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGroundedDeadline } from "../functions/qca-extraction.mjs";

const notices = JSON.parse(readFileSync(new URL("../data/sample-notices.json", import.meta.url), "utf8"));
const expected = JSON.parse(readFileSync(new URL("../data/expected-tasks.json", import.meta.url), "utf8"));
const byId = new Map(notices.notices.map((notice) => [notice.id, notice]));
let confirmedDeadlines = 0;
let uncertainDeadlines = 0;

assert.equal(notices.notices.length, 8);
assert.equal(expected.tasks.length, 15);
for (const task of expected.tasks) {
  const notice = byId.get(task.noticeId);
  assert.ok(notice, `${task.id}: 通知不存在`);
  const start = notice.body.indexOf(task.sourceQuote);
  assert.notEqual(start, -1, `${task.id}: 摘录不是原文连续片段`);
  assert.equal(notice.body.slice(start, start + task.sourceQuote.length), task.sourceQuote, `${task.id}: 原文偏移不匹配`);
  assert.equal(task.role, notice.role, `${task.id}: 角色不一致`);
  if (task.deadlineText !== null) {
    assert.ok(notice.body.includes(task.deadlineText), `${task.id}: 时间表述不是原文连续片段`);
  }
  if (task.deadline) {
    assert.match(task.deadline, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(task.deadlineText, `${task.id}: 明确日期缺少原文时间表述`);
    assert.ok(
      isGroundedDeadline(task.deadlineText, task.deadline, notice.receivedAt.slice(0, 10)),
      `${task.id}: 日期与原文时间表述不一致`,
    );
    confirmedDeadlines += 1;
  } else {
    assert.notEqual(task.category, "action", `${task.id}: 无日期任务需明确分类`);
    uncertainDeadlines += 1;
  }
}

for (const sample of notices.pasteSamples) {
  assert.ok(sample.body.length > 0 && sample.body.length <= 12000);
}

console.log(`通过：${notices.notices.length} 条通知，${expected.tasks.length} 条任务，全部摘录和时间表述可回查；${confirmedDeadlines} 个明确日期均与原文时间一致，${uncertainDeadlines} 个空日期（含仅阅知）。`);
