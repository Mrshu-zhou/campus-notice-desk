import assert from "node:assert/strict";
import test from "node:test";
import { createAiCoordinator } from "../functions/ai-coordinator.mjs";
import { ensureCloudResources } from "../functions/cloud-agents.mjs";
import {
  QcaExtractionError,
  createQcaExtractor,
  parseExtractionOutput,
  parseExtractionResult,
  selectModelId,
} from "../functions/qca-extraction.mjs";

class FakeDb {
  constructor() {
    this.tables = new Map();
  }

  rows(table) {
    if (!this.tables.has(table)) this.tables.set(table, new Map());
    return this.tables.get(table);
  }

  from(table) {
    return new Query(this.rows(table));
  }
}

class Query {
  constructor(rows) {
    this.rows = rows;
    this.op = "select";
    this.conditions = [];
    this.payload = null;
    this.limitValue = Infinity;
  }

  select() {
    if (this.op === "update" || this.op === "insert") return this.execute();
    return this;
  }

  update(payload) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  insertIfAbsent(row, options) {
    assert.equal(options?.onConflict, "lock_key");
    this.op = "insert";
    this.payload = row;
    return this;
  }

  eq(column, value) {
    this.conditions.push([column, value]);
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this.execute();
  }

  matches(row) {
    return this.conditions.every(([column, value]) => row[column] === value);
  }

  clone(row) {
    return row === null || row === undefined ? row : structuredClone(row);
  }

  async execute() {
    const all = [...this.rows.values()];
    if (this.op === "select") {
      return { data: all.filter((row) => this.matches(row)).slice(0, this.limitValue).map((row) => this.clone(row)), error: null };
    }
    if (this.op === "insert") {
      if (this.rows.has(this.payload.lock_key)) return { data: [], error: null };
      this.rows.set(this.payload.lock_key, this.clone(this.payload));
      return { data: [this.clone(this.payload)], error: null };
    }
    const updated = [];
    const now = Date.now();
    for (const [key, row] of this.rows) {
      if (!this.matches(row)) continue;
      const next = { ...row, ...this.clone(this.payload) };
      if (Object.prototype.hasOwnProperty.call(this.payload, "updated_at") === false) next.updated_at = new Date(now).toISOString();
      this.rows.set(key, next);
      updated.push(this.clone(next));
    }
    return { data: updated, error: null };
  }
}

const body = "请于11月30日17:00前报送本班参加冬季长跑的学生名单（Excel），发本邮箱。";
const validTask = {
  id: "t1",
  title: "报送冬季长跑名单",
  action: "将学生名单 Excel 发送至本邮箱。",
  deadline: "2026-11-30",
  deadlineText: "11月30日17:00前",
  materials: ["学生名单 Excel"],
  category: "action",
  sourceQuote: "11月30日17:00前报送本班参加冬季长跑的学生名单",
};
const pngData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const image = { id: "img1", mediaType: "image/png", data: pngData };
const imageText = "实验室安全准入：请于2026年11月28日17:00前，将本班实验室安全承诺书交到信息楼A312。";
const imageTask = {
  ...validTask,
  title: "提交实验室安全承诺书",
  action: "收齐本班实验室安全承诺书，交到信息楼A312。",
  deadline: "2026-11-28",
  deadlineText: "2026年11月28日17:00前",
  materials: ["实验室安全承诺书"],
  category: "action",
  sourceQuote: "2026年11月28日17:00前，将本班实验室安全承诺书交到信息楼A312",
  sourceImageId: "img1",
  relevance: "required",
  uncertainty: null,
};
const imageRead = { imageId: "img1", text: imageText, uncertain: false, notes: "" };

test("discovers an enabled model and prefers the configured default", () => {
  assert.equal(selectModelId({ data: [{ id: "fast", is_enabled: true }], has_more: false }), "fast");
  assert.equal(
    selectModelId({ data: [{ id: "fast", is_enabled: true }, { id: "ultimate", is_enabled: true }], has_more: false }),
    "ultimate",
  );
  assert.throws(
    () => selectModelId({ data: [{ id: "ultimate", is_enabled: false }], has_more: false }),
    (error) => error instanceof QcaExtractionError && error.code === "ai_model_unavailable",
  );
  assert.throws(
    () => selectModelId({ data: [{ id: "../escape", is_enabled: true }], has_more: false }),
    (error) => error instanceof QcaExtractionError && error.code === "ai_response_invalid",
  );
  assert.throws(
    () => selectModelId({ data: [], has_more: true }),
    (error) => error instanceof QcaExtractionError && error.code === "ai_response_invalid",
  );
});

test("accepts a verbatim quote and a confirmed date", () => {
  const tasks = parseExtractionOutput(JSON.stringify({ tasks: [validTask] }), body, "2026-11-20");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "t1");
  assert.equal(tasks[0].category, "action");
  assert.equal(tasks[0].sourceQuote, validTask.sourceQuote);
});

test("anchors an image task to the model transcription and keeps its provenance", () => {
  const result = parseExtractionResult(
    JSON.stringify({ imageReads: [imageRead], ignored: [], tasks: [imageTask] }),
    "",
    "2026-11-21",
    [image],
  );
  assert.equal(result.imageReads[0].imageId, "img1");
  assert.equal(result.tasks[0].sourceImageId, "img1");
  assert.equal(result.tasks[0].deadline, "2026-11-28");
  assert.equal(result.tasks[0].category, "action");
});

test("downgrades every task from an uncertain image and explains why", () => {
  const result = parseExtractionResult(
    JSON.stringify({
      imageReads: [{ ...imageRead, uncertain: true, notes: "右下角被裁切" }],
      ignored: [],
      tasks: [{ ...imageTask, uncertainty: null }],
    }),
    "",
    "2026-11-21",
    [image],
  );
  assert.equal(result.tasks[0].category, "needs_confirm");
  assert.match(result.tasks[0].uncertainty, /看不清|裁切/);
});

test("keeps a readable task actionable while flagging an unshown attachment", () => {
  const result = parseExtractionResult(
    JSON.stringify({
      imageReads: [imageRead],
      ignored: [],
      tasks: [{ ...imageTask, uncertainty: "群文件附件未展示，需要回原聊天软件下载核对。" }],
    }),
    "",
    "2026-11-21",
    [image],
  );
  assert.equal(result.tasks[0].category, "action");
  assert.match(result.tasks[0].uncertainty, /群文件/);
});

test("rejects image evidence that is not present in its own transcription", () => {
  const cases = [
    { ...imageTask, sourceImageId: "img2" },
    { ...imageTask, sourceQuote: "请于11月28日17:00前提交" },
  ];
  for (const task of cases) {
    assert.throws(
      () => parseExtractionResult(
        JSON.stringify({ imageReads: [imageRead], ignored: [], tasks: [task] }),
        "",
        "2026-11-21",
        [image],
      ),
      (error) => error instanceof QcaExtractionError && error.code === "ai_response_invalid",
    );
  }
});

test("requires one transcription per uploaded image and rejects stray reads", () => {
  assert.throws(
    () => parseExtractionResult(
      JSON.stringify({ imageReads: [], ignored: [], tasks: [] }),
      "",
      "2026-11-21",
      [image],
    ),
    QcaExtractionError,
  );
  assert.throws(
    () => parseExtractionResult(
      JSON.stringify({ imageReads: [{ ...imageRead, imageId: "img9" }], ignored: [], tasks: [] }),
      "",
      "2026-11-21",
      [image],
    ),
    QcaExtractionError,
  );
  assert.throws(
    () => parseExtractionResult(
      JSON.stringify({ imageReads: [imageRead], ignored: [], tasks: [] }),
      body,
      "2026-11-21",
      [],
    ),
    QcaExtractionError,
  );
});

test("keeps ignored chat out of tasks while recording it separately", () => {
  const result = parseExtractionResult(
    JSON.stringify({
      imageReads: [],
      ignored: [{ text: "收到，谢谢班长", reason: "acknowledgement" }],
      tasks: [],
    }),
    body,
    "2026-11-21",
    [],
  );
  assert.equal(result.tasks.length, 0);
  assert.equal(result.ignored[0].reason, "acknowledgement");
});

test("grounds a relative date when it agrees with the source date", () => {
  const weeklyBody = "2）下周一（11月23日）晚7点班级开班会，主题是防诈骗，签到表会后当天提交。";
  const task = {
    ...validTask,
    deadline: "2026-11-23",
    deadlineText: "下周一（11月23日）晚7点",
    category: "action",
    sourceQuote: weeklyBody,
  };
  const tasks = parseExtractionOutput(JSON.stringify({ tasks: [task] }), weeklyBody, "2026-11-19");
  assert.equal(tasks[0].deadline, "2026-11-23");
  assert.equal(tasks[0].category, "action");
});

test("resolves midnight tonight to the next calendar day", () => {
  const lateBody = "英语四级报名今晚12点截止。";
  const task = {
    ...validTask,
    deadline: "2026-11-21",
    deadlineText: "今晚12点",
    sourceQuote: lateBody,
  };
  const tasks = parseExtractionOutput(JSON.stringify({ tasks: [task] }), lateBody, "2026-11-20");
  assert.equal(tasks[0].deadline, "2026-11-21");
  assert.equal(tasks[0].category, "action");
});

test("downgrades conflicting, mismatched and unverifiable dates", () => {
  const conflictBody = "下周一（11月24日）晚7点班级开班会。";
  const weekdayBody = "时间：11月28日（周五）23:59前将材料提交到课程平台";
  const vagueBody = "请于近期报送材料，具体截止时间另行通知。";
  const cases = [
    {
      task: { ...validTask, deadline: "2026-11-24", deadlineText: "下周一（11月24日）", sourceQuote: conflictBody },
      body: conflictBody,
      today: "2026-11-19",
    },
    {
      task: { ...validTask, deadline: "2026-11-28", deadlineText: "11月28日（周五）", sourceQuote: weekdayBody },
      body: weekdayBody,
      today: "2026-11-20",
    },
    {
      task: { ...validTask, deadline: "2025-11-30" },
      body,
      today: "2026-11-20",
    },
    {
      task: { ...validTask, deadlineText: null },
      body,
      today: "2026-11-20",
    },
    {
      task: { ...validTask, deadlineText: "另行通知", sourceQuote: vagueBody },
      body: vagueBody,
      today: "2026-11-20",
    },
    {
      task: { ...validTask, deadline: "2026-11-21", deadlineText: "11月21日-22日", sourceQuote: "闭馆时间为11月21日-22日。" },
      body: "闭馆时间为11月21日-22日。",
      today: "2026-11-20",
    },
  ];
  for (const item of cases) {
    const tasks = parseExtractionOutput(JSON.stringify({ tasks: [item.task] }), item.body, item.today);
    assert.equal(tasks[0].deadline, null);
    assert.equal(tasks[0].category, "needs_confirm");
  }
});

test("rejects deadline text that is not a verbatim source excerpt", () => {
  const task = { ...validTask, deadlineText: "11月30日 17:00 前" };
  assert.throws(
    () => parseExtractionOutput(JSON.stringify({ tasks: [task] }), body, "2026-11-20"),
    (error) => error instanceof QcaExtractionError && error.code === "ai_response_invalid",
  );
});

test("downgrades action without a confirmed date", () => {
  const tasks = parseExtractionOutput(JSON.stringify({ tasks: [{ ...validTask, deadline: null, deadlineText: null }] }), body);
  assert.equal(tasks[0].category, "needs_confirm");
});

test("accepts a fenced JSON response", () => {
  const tasks = parseExtractionOutput("```json\n" + JSON.stringify({ tasks: [validTask] }) + "\n```", body);
  assert.equal(tasks.length, 1);
});

test("finds the JSON object when the model wraps it in an explanation", () => {
  const text = "已读取截图。\n```json\n" + JSON.stringify({ tasks: [validTask] }) + "\n```\n请核对。";
  const tasks = parseExtractionOutput(text, body);
  assert.equal(tasks.length, 1);
});

test("rejects fabricated, concatenated and malformed tasks", () => {
  const cases = [
    { ...validTask, sourceQuote: "11月30日17:00前报送名单" },
    { ...validTask, deadline: "2026-02-30" },
    { ...validTask, extra: "forged" },
    { ...validTask, materials: [""] },
    { ...validTask, category: "urgent" },
  ];
  for (const task of cases) {
    assert.throws(
      () => parseExtractionOutput(JSON.stringify({ tasks: [task] }), body),
      (error) => error instanceof QcaExtractionError && error.code === "ai_response_invalid",
    );
  }
  assert.throws(() => parseExtractionOutput("{\"tasks\":[]}{\"tasks\":[]}", body), QcaExtractionError);
});

test("serializes concurrent work and fences a released lease", async () => {
  const db = new FakeDb();
  const coordinator = createAiCoordinator({ db, leaseMs: 10_000, waitMs: 3_000 });
  const key = "a".repeat(64);
  const events = [];
  let active = 0;
  let maxActive = 0;

  async function job(number) {
    return coordinator.withLock(key, async (lease) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`start-${number}`);
      await lease.read();
      await lease.write({ state: "creating", number });
      await new Promise((resolve) => setTimeout(resolve, 40));
      await lease.assertHeld();
      events.push(`end-${number}`);
      active -= 1;
      return number;
    });
  }

  assert.deepEqual(await Promise.all([job(1), job(2)]), [1, 2]);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ["start-1", "end-1", "start-2", "end-2"]);

  let stale;
  await coordinator.withLock(key, async (lease) => {
    stale = lease;
    await lease.write({ state: "ready", id: "env_test" });
  });
  await assert.rejects(
    stale.write({ state: "ready", id: "env_other" }),
    (error) => error.code === "ai_initialization_conflict",
  );
});

test("reuses one Agent and Environment across repeated initialization", async () => {
  const db = new FakeDb();
  const coordinator = createAiCoordinator({ db, leaseMs: 10_000, waitMs: 3_000 });
  const resources = { agents: [], environments: [] };
  let sequence = 0;
  const client = {
    async findResources(kind, metadata) {
      return resources[kind].filter((resource) => Object.entries(metadata).every(([key, value]) => resource.metadata[key] === value));
    },
    async request(path, { method, body }) {
      assert.equal(method, "POST");
      const kind = path.endsWith("/agents") ? "agents" : "environments";
      const id = `${kind === "agents" ? "agent" : "env"}_${++sequence}`;
      const resource = { id, version: 1, metadata: body.metadata, archived_at: null };
      resources[kind].push(resource);
      return resource;
    },
  };
  const options = {
    client,
    coordinator,
    applicationScope: "campus-notice-desk.test.v1",
    agent: { name: "抽取器", model: "ultimate", system: "只输出 JSON", tools: [], metadata: { app: "test" } },
    environment: { name: "测试环境", config: { type: "cloud" }, metadata: { app: "test" } },
  };

  const first = await ensureCloudResources(options);
  const second = await ensureCloudResources(options);
  assert.deepEqual(first, second);
  assert.equal(resources.agents.length, 1);
  assert.equal(resources.environments.length, 1);
});
test("requires an explicit Cloud Agents origin", async () => {
  const extractor = createQcaExtractor({ db: new FakeDb(), fetchImpl: () => assert.fail("must not fetch") });
  const input = { role: "counselor", today: "2026-11-20", sourceType: "email", body };
  await assert.rejects(
    extractor.extract(input),
    (error) => error instanceof QcaExtractionError && error.code === "ai_configuration_invalid",
  );
});

test("runs the QCA flow end to end and reuses initialized resources", async () => {
  globalThis.Deno = { env: { get: () => "test-token" } };
  const db = new FakeDb();
  const calls = { models: 0, environments: 0, agents: 0, sessions: 0, archive: 0, cancel: 0, scans: { environments: 0, agents: 0 } };
  let sessionSequence = 0;
  let imageSent = false;
  const tasks = [{ ...validTask }];

  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method ?? "GET";
    const send = (payload) => Response.json(payload, { headers: { "Content-Type": "application/json" } });
    const replyPayload = sessionSequence === 2
      ? { imageReads: [imageRead], ignored: [], tasks: [imageTask] }
      : { tasks };
    const agentReply = {
      id: `evt_agent_${sessionSequence}`,
      type: "agent.message",
      content: [{ type: "text", text: JSON.stringify(replyPayload) }],
      processed_at: new Date().toISOString(),
    };
    const userEvent = { id: "evt_user", type: "user.message", content: [{ type: "text", text: "prompt" }] };

    if (method === "GET" && parsed.pathname === "/api/v1/cloud/models") {
      calls.models += 1;
      return send({
        data: [{ id: "ultimate", type: "model", display_name: "Ultimate", source: "system", is_enabled: true }],
        has_more: false,
      });
    }
    if (method === "GET" && parsed.pathname === "/api/v1/cloud/environments") {
      calls.scans.environments += 1;
      return send({ data: [], has_more: false, next_page: null });
    }
    if (method === "GET" && parsed.pathname === "/api/v1/cloud/agents") {
      calls.scans.agents += 1;
      return send({ data: [], has_more: false, next_page: null });
    }
    if (method === "POST" && parsed.pathname === "/api/v1/cloud/environments") {
      calls.environments += 1;
      const body = JSON.parse(options.body);
      return send({ id: "env_flow", version: 1, metadata: body.metadata, archived_at: null });
    }
    if (method === "POST" && parsed.pathname === "/api/v1/cloud/agents") {
      calls.agents += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.model, "ultimate");
      assert.equal(body.tools.length, 0);
      assert.match(body.system, /sourceQuote/);
      assert.match(body.system, /imageReads/);
      return send({ id: "agent_flow", version: 1, metadata: body.metadata, archived_at: null });
    }
    if (method === "POST" && parsed.pathname === "/api/v1/cloud/sessions") {
      calls.sessions += 1;
      sessionSequence += 1;
      return send({ id: `sess_flow_${sessionSequence}`, status: "running" });
    }
    if (method === "POST" && /\/events$/.test(parsed.pathname)) {
      const payload = JSON.parse(options.body);
      const content = payload.events[0].content;
      assert.equal(payload.events[0].type, "user.message");
      assert.match(content[0].text, /截图清单/);
      if (sessionSequence === 2) {
        assert.equal(content.length, 2);
        assert.deepEqual(content[1], {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: pngData },
        });
        imageSent = true;
      } else {
        assert.equal(content.length, 1);
        assert.match(content[0].text, /请于11月30日17:00前报送/);
      }
      return send(userEvent);
    }
    if (method === "GET" && /\/events$/.test(parsed.pathname)) {
      return send({ data: [userEvent, agentReply], has_more: false, next_page: null });
    }
    if (method === "GET" && /^\/api\/v1\/cloud\/sessions\/sess_flow_\d+$/.test(parsed.pathname)) {
      const id = parsed.pathname.split("/").at(-1);
      return send({ id, status: id === "sess_flow_1" ? "running" : "idle" });
    }
    if (method === "POST" && parsed.pathname.endsWith("/archive")) {
      calls.archive += 1;
      return send({ status: "idle" });
    }
    if (method === "POST" && parsed.pathname.endsWith("/cancel")) {
      calls.cancel += 1;
      return send({ status: "cancelled" });
    }
    throw new Error(`unexpected fetch: ${method} ${parsed.pathname}`);
  };

  const extractor = createQcaExtractor({ db, origin: "https://api.qoder.com.cn", fetchImpl });
  const input = { role: "counselor", today: "2026-11-20", sourceType: "email", body, images: [] };
  const first = await extractor.extract(input);
  const second = await extractor.extract({ ...input, body: "", images: [image] });

  assert.equal(first.tasks[0].title, validTask.title);
  assert.equal(first.tasks[0].sourceQuote, validTask.sourceQuote);
  assert.equal(second.tasks[0].sourceImageId, "img1");
  assert.equal(second.imageReads[0].imageId, "img1");
  assert.equal(imageSent, true);
  assert.equal(calls.models, 1);
  assert.equal(calls.environments, 1);
  assert.equal(calls.agents, 1);
  assert.equal(calls.sessions, 2);
  assert.equal(calls.cancel, 1);
  assert.equal(calls.archive, 1);
  assert.equal(calls.scans.environments, 1);
  assert.equal(calls.scans.agents, 1);
});
