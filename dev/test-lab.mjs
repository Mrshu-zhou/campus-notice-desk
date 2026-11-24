import assert from "node:assert/strict";
import test from "node:test";

import { verifyLabResult } from "../src/lib/agent-lab.ts";

const body = "请于11月30日17:00前报送本班参加冬季长跑的学生名单（Excel），发本邮箱。";

function task(overrides = {}) {
  return {
    id: "t1",
    noticeId: "lab",
    role: "counselor",
    title: "报送冬季长跑名单",
    action: "把名单 Excel 发到邮箱。",
    deadline: "2026-11-30",
    deadlineText: "11月30日17:00前",
    materials: [],
    category: "action",
    status: "todo",
    sourceQuote: "11月30日17:00前报送本班参加冬季长跑的学生名单",
    sourceStart: null,
    sourceEnd: null,
    origin: "cloud_agent",
    ...overrides,
  };
}

test("counts only quotes whose stored offsets resolve to the same body slice", () => {
  const quote = "11月30日17:00前报送本班参加冬季长跑的学生名单";
  const start = body.indexOf(quote);
  const verification = verifyLabResult(body, [
    task({ sourceStart: start, sourceEnd: start + quote.length }),
    task({
      id: "t2",
      title: "确认模糊日期",
      category: "needs_confirm",
      deadline: null,
      deadlineText: "另行通知",
      sourceQuote: "另行通知",
      sourceStart: null,
      sourceEnd: null,
    }),
  ]);

  assert.equal(verification.total, 2);
  assert.equal(verification.quoteOk, 1);
  assert.equal(verification.quoteBroken, 1);
  assert.equal(verification.quotes[0].ok, true);
  assert.equal(verification.quotes[0].start, start);
  assert.equal(verification.quotes[1].ok, false);
  assert.equal(verification.dated, 1);
  assert.equal(verification.needsConfirm, 1);
  assert.equal(verification.fyi, 0);
  assert.equal(verification.deadlines[0].confirmed, true);
  assert.equal(verification.deadlines[1].confirmed, false);
});

test("a wrong offset is not treated as a verified source span", () => {
  const verification = verifyLabResult(body, [
    task({ sourceStart: 0, sourceEnd: 5 }),
  ]);
  assert.equal(verification.quoteOk, 0);
  assert.equal(verification.quoteBroken, 1);
  assert.equal(verification.quotes[0].ok, false);
});

console.log("通过：流水线可视化门闸统计测试（内部验证，不是官方赛分）。");
