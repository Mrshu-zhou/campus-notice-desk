import assert from "node:assert/strict";
import test from "node:test";

import { applyRoleState } from "../src/lib/tasks.ts";

function task(overrides = {}) {
  return {
    id: "t1",
    noticeId: "n1",
    role: "student",
    title: "提交材料",
    action: "提交材料",
    deadline: null,
    deadlineText: null,
    materials: [],
    category: "needs_confirm",
    status: "todo",
    sourceQuote: "提交材料",
    sourceStart: 0,
    sourceEnd: 4,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    read: {},
    done: {},
    deadlines: {},
    customNotices: [],
    customTasks: [],
    demoComplete: false,
    tourDismissed: false,
    ...overrides,
  };
}

test("keeps a needs_confirm task with a date unconfirmed", () => {
  const [result] = applyRoleState(
    [task({ category: "needs_confirm", deadline: "2026-11-25" })],
    state(),
  );
  assert.equal(result.category, "needs_confirm");
  assert.equal(result.deadline, "2026-11-25");
});

test("keeps an action task with a date actionable", () => {
  const [result] = applyRoleState(
    [task({ category: "action", deadline: "2026-11-25" })],
    state(),
  );
  assert.equal(result.category, "action");
});

test("keeps the extraction category when an action task has no date", () => {
  const [result] = applyRoleState([task({ category: "action" })], state());
  assert.equal(result.category, "action");
  assert.equal(result.deadline, null);
});

test("applies a saved deadline override without rewriting the extraction category", () => {
  const [result] = applyRoleState(
    [task({ category: "needs_confirm" })],
    state({ deadlines: { t1: "2026-11-26" } }),
  );
  assert.equal(result.category, "needs_confirm");
  assert.equal(result.deadline, "2026-11-26");
});

test("clears a saved deadline override without rewriting the extraction category", () => {
  const [result] = applyRoleState(
    [task({ category: "action", deadline: "2026-11-25" })],
    state({ deadlines: { t1: null } }),
  );
  assert.equal(result.category, "action");
  assert.equal(result.deadline, null);
});

test("keeps an fyi task out of the action list", () => {
  const [result] = applyRoleState(
    [task({ category: "fyi", deadline: "2026-11-25" })],
    state(),
  );
  assert.equal(result.category, "fyi");
});

test("keeps read and done independent", () => {
  const [result] = applyRoleState(
    [task({ category: "action", deadline: "2026-11-25" })],
    state({ read: { t1: true }, done: { t1: true } }),
  );
  assert.equal(result.status, "done");
  assert.equal(result.category, "action");
});