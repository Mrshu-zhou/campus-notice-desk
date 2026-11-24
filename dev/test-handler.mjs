import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import sampleNotices from "../data/sample-notices.json" with { type: "json" };
import { handleExtractionRequest } from "../functions/handler.ts";
import { QcaExtractionError, toPublicError } from "../functions/qca-extraction.mjs";
import { verifyLabResult } from "../src/lib/agent-lab.ts";
import { gateExtractedTasks } from "../src/lib/gates.ts";
import { localFixtureHandler } from "./local-fixture-handler.ts";

const endpoint = "http://127.0.0.1:8001/functions/v1/app?action=extract";
const validInput = {
  role: "student",
  today: "2026-11-20",
  sourceType: "wechat_group",
  body: "请于11月25日前提交材料。",
};
const pngData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const demoImageBase64 = readFileSync(new URL("../public/demo/lab-safety-notice.png", import.meta.url)).toString("base64");

function request(body, options = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...options,
  });
}

test("accepts a valid extraction request and forwards the parsed input", async () => {
  let received;
  const response = await handleExtractionRequest(request(validInput), (input) => {
    received = input;
    return Response.json({ ok: true, mode: "cloud_agent", tasks: [] });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { ...validInput, images: [] });
});

test("accepts a screenshot-only request with a matching image type", async () => {
  let received;
  const input = {
    ...validInput,
    body: "",
    images: [{ id: "img1", mediaType: "image/png", data: pngData }],
  };
  const response = await handleExtractionRequest(request(input), (parsed) => {
    received = parsed;
    return Response.json({ ok: true, mode: "cloud_agent", tasks: [] });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, input);
});

test("rejects unsupported actions and methods", async () => {
  const wrongAction = await handleExtractionRequest(
    new Request("http://127.0.0.1:8001/functions/v1/app?action=other", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validInput),
    }),
    () => assert.fail("callback must not run"),
  );
  assert.equal(wrongAction.status, 404);

  const wrongMethod = await handleExtractionRequest(
    new Request(endpoint, { method: "GET" }),
    () => assert.fail("callback must not run"),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
});

test("rejects wrong content types, malformed JSON and invalid fields", async () => {
  const wrongType = await handleExtractionRequest(
    new Request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(validInput),
    }),
    () => assert.fail("callback must not run"),
  );
  assert.equal(wrongType.status, 415);

  const malformed = await handleExtractionRequest(request("{"), () => assert.fail("callback must not run"));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "invalid_json");

  for (const invalid of [
    { ...validInput, role: "teacher" },
    { ...validInput, today: "2026-02-30" },
    { ...validInput, body: "   " },
    { ...validInput, extra: true },
    { ...validInput, body: "a".repeat(12001) },
    { ...validInput, images: "not-an-array" },
    { ...validInput, images: [{ id: "img1", mediaType: "image/jpeg", data: pngData }] },
    { ...validInput, images: [{ id: "img1", mediaType: "image/png", data: "AAAA" }] },
    {
      ...validInput,
      images: Array.from({ length: 5 }, (_, index) => ({ id: `img${index + 1}`, mediaType: "image/png", data: pngData })),
    },
  ]) {
    const response = await handleExtractionRequest(request(invalid), () => assert.fail("callback must not run"));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_input");
  }
});

test("rejects request bodies over the byte limit", async () => {
  const oversized = { ...validInput, body: "a".repeat(10 * 1024 * 1024) };
  const response = await handleExtractionRequest(request(oversized), () => assert.fail("callback must not run"));
  assert.equal(response.status, 413);
});

test("maps extraction failures to safe public responses", () => {
  const rateLimited = toPublicError(new QcaExtractionError("ai_rate_limited", 429, "upstream detail", "diag-1"));
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error, "ai_rate_limited");
  assert.equal(rateLimited.body.diagnosticId, "diag-1");
  assert.equal(JSON.stringify(rateLimited).includes("upstream detail"), false);

  const unknown = toPublicError(new Error("upstream detail"));
  assert.equal(unknown.status, 503);
  assert.equal(unknown.body.message, "在线拆解暂时不可用，请稍后重试。");
  assert.equal(JSON.stringify(unknown).includes("upstream detail"), false);
});

test("class group fixture keeps the ambiguous form date unconfirmed", async () => {
  const classNotice = sampleNotices.notices.find((notice) => notice.id === "stu-wechat-class-forward");
  const response = await localFixtureHandler(request({ ...validInput, body: classNotice.body }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, "local_fixture");
  assert.deepEqual(result.tasks.map((task) => task.deadline), [null, "2026-11-25", "2026-11-23"]);
  assert.equal(result.tasks[0].category, "needs_confirm");
});

test("local fixtures stay clearly local and resolve tonight against the request date", async () => {
  const sampleBody = sampleNotices.pasteSamples[0].body;
  const response = await localFixtureHandler(request({ ...validInput, body: sampleBody }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, "local_fixture");
  assert.equal(result.tasks[0].deadline, "2026-11-21");

  const unsupported = await localFixtureHandler(request(validInput));
  assert.equal(unsupported.status, 503);
  assert.equal((await unsupported.json()).error, "cloud_agent_not_enabled");
});

test("the built-in demo screenshot is a verified local_fixture sample", async () => {
  const response = await localFixtureHandler(request({
    ...validInput,
    body: "",
    images: [{ id: "demo-lab-safety", mediaType: "image/png", data: demoImageBase64 }],
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, "local_fixture");
  assert.deepEqual(result.tasks.map((task) => task.id), ["local-demo-lab-safety", "local-demo-fire-drill"]);
  assert.deepEqual(result.tasks.map((task) => task.deadline), ["2026-11-27", "2026-11-26"]);
  for (const task of result.tasks) {
    assert.equal(task.sourceImageId, "demo-lab-safety");
    assert.ok(task.sourceQuote.length > 0);
  }
  assert.equal(result.imageReads.length, 1);
  assert.equal(result.imageReads[0].uncertain, false);
  assert.equal(result.ignored.length, 5);

  const gated = gateExtractedTasks({
    body: "",
    role: "student",
    noticeId: "notice-demo",
    tasks: result.tasks,
    imageReads: result.imageReads,
    origin: "local_fixture",
  });
  assert.deepEqual(gated.map((task) => task.id), ["local-demo-lab-safety", "local-demo-fire-drill"]);
  assert.ok(gated.every((task) => task.category === "action"));
  assert.ok(gated.every((task) => task.sourceStart !== null));
  assert.equal(verifyLabResult("", gated, result.imageReads).quoteOk, 2);
});

test("unknown screenshots fail honestly instead of faking cloud extraction", async () => {
  const response = await localFixtureHandler(request({
    ...validInput,
    body: "",
    images: [{ id: "img-unknown", mediaType: "image/png", data: pngData }],
  }));
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.error, "cloud_agent_not_enabled");
  assert.match(result.message, /本地预览只对已核对样例/);
  assert.match(result.message, /不会在本地假装在线拆解成功/);
});