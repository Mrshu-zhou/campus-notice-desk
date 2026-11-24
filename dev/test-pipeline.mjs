import assert from "node:assert/strict";
import test from "node:test";

import {
  PIPELINE_STAGES,
  appendPipelineLog,
  createPipelineRun,
  initialPipelineStages,
  patchPipelineStage,
  stageStatusLabel,
} from "../src/lib/pipeline.ts";

const baseInput = {
  noticeId: "stu-wechat-class-forward",
  source: "demo",
  role: "student",
  sourceType: "wechat_group",
  roleLabel: "学生",
  sourceLabel: "班级群",
  bodyLength: 638,
  today: "2026-11-20",
  startedAt: 1000,
};

test("creates an idle run with six waiting stages", () => {
  const run = createPipelineRun(baseInput);
  assert.equal(run.phase, "idle");
  assert.equal(run.mode, null);
  assert.deepEqual(Object.keys(run.stages).sort(), PIPELINE_STAGES.map((stage) => stage.id).sort());
  assert.equal(PIPELINE_STAGES.length, 6);
  for (const stage of PIPELINE_STAGES) assert.equal(run.stages[stage.id].status, "idle");
});

test("patches one stage without mutating the previous run", () => {
  const run = createPipelineRun(baseInput);
  const next = patchPipelineStage(run, "agent", { status: "active", note: "正在调用" });
  assert.equal(run.stages.agent.status, "idle");
  assert.equal(next.stages.agent.status, "active");
  assert.equal(next.stages.quotes.status, "idle");
  assert.equal(next.noticeId, run.noticeId);
});

test("appends logs with stable increasing ids and tone", () => {
  let run = createPipelineRun(baseInput);
  run = appendPipelineLog(run, "第一步");
  run = appendPipelineLog(run, "失败步骤", "fail");
  assert.deepEqual(run.logs.map((entry) => entry.id), [1, 2]);
  assert.equal(run.logs[1].tone, "fail");
  assert.ok(run.logs.every((entry) => entry.time.length > 0));
});

test("labels the skipped agent stage honestly", () => {
  const stages = initialPipelineStages();
  assert.equal(stages.agent.status, "idle");
  assert.equal(stageStatusLabel("skipped"), "跳过");
  assert.equal(stageStatusLabel("failed"), "中断");
});
