import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CalendarCheck2,
  Check,
  CircleAlert,
  Factory,
  FlaskConical,
  Inbox,
  ListChecks,
  LoaderCircle,
  Play,
  ScanText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { CLASS_NOTICE_ID, pasteImportAdapter, pasteSamples, seedNotices, sourceLabels } from "../data";
import { verifyLabResult, type LabVerification } from "../lib/agent-lab";
import { extractTasks } from "../lib/extraction";
import { formatShortDate } from "../lib/tasks";
import type { ExtractionResult, ExtractionTrace, Notice, Role, SourceType, Task } from "../types";

const STAGES = [
  { id: "ingest", label: "原文入站", note: "接收群聊或邮件原文", icon: Inbox },
  { id: "request", label: "请求门闸", note: "字段、长度与来源检查", icon: ShieldCheck },
  { id: "agent", label: "智能拆解", note: "抽取候选任务", icon: Sparkles },
  { id: "quotes", label: "原文对账", note: "摘录必须连续可定位", icon: ScanText },
  { id: "dates", label: "日期落地", note: "模糊时间降级待确认", icon: CalendarCheck2 },
  { id: "assemble", label: "装配待办", note: "去重合并后写入候选", icon: ListChecks },
] as const;

type LabStageId = (typeof STAGES)[number]["id"];
type LabStageStatus = "idle" | "active" | "done" | "failed";
type LabRunPhase = "idle" | "running" | "done" | "failed";
type LabInputMode = "sample" | "custom";
type LabTone = "info" | "ok" | "fail";

interface LabStageState {
  status: LabStageStatus;
  note: string;
  durationMs?: number;
}

interface LabSample {
  id: string;
  title: string;
  summary: string;
  role: Role;
  sourceType: SourceType;
  body: string;
  doNotExtract?: string[];
}

interface LabLogEntry {
  id: number;
  time: string;
  text: string;
  tone: LabTone;
}

interface LabResult {
  notice: Notice;
  mode: ExtractionResult["mode"];
  tasks: Task[];
  verification: LabVerification;
  trace?: ExtractionTrace;
  elapsedMs: number;
}

interface Props {
  role: Role;
  today: string;
  onSave: (notice: Notice, tasks: Task[], mode: ExtractionResult["mode"]) => void;
  onOpenResult?: (noticeId: string, taskId?: string) => void;
}

const MODE_LABELS: Record<ExtractionResult["mode"], string> = {
  cloud_agent: "Cloud Agent 在线拆解",
  local_fixture: "本地核对样例",
  verified_offline: "离线已核对",
};

const IDLE_NOTES: Record<LabStageId, string> = {
  ingest: "选择一段已核对样例，或在上方写一条自己的通知。",
  request: "请求只接受角色、今天日期、来源和正文四个字段。",
  agent: "在线模式会调用 Qoder Cloud Agent；本地模式只返回已核对样例。",
  quotes: "运行后会逐条检查任务摘录能否在原文中连续找到。",
  dates: "运行后会检查截止日期是否与原文时间表述一致。",
  assemble: "通过门闸的任务可以写入通知收件箱。",
};

function roleLabel(role: Role) {
  return role === "student" ? "学生" : "辅导员";
}

function modeLabel(mode: ExtractionResult["mode"] | null | undefined) {
  return mode ? MODE_LABELS[mode] : "";
}

function initialStages(): Record<LabStageId, LabStageState> {
  return STAGES.reduce((all, stage) => ({
    ...all,
    [stage.id]: { status: "idle", note: "" },
  }), {} as Record<LabStageId, LabStageState>);
}

function stageStatusLabel(status: LabStageStatus) {
  if (status === "active") return "运行中";
  if (status === "done") return "完成";
  if (status === "failed") return "中断";
  return "待机";
}

function nowText() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function pause(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AgentLab({ role, today, onSave, onOpenResult }: Props) {
  const samples = useMemo<LabSample[]>(() => {
    const classNotice = seedNotices.find((notice) => notice.id === CLASS_NOTICE_ID);
    const studentPaste = pasteSamples.find((sample) => sample.id === "paste-demo-student");
    const counselorPaste = pasteSamples.find((sample) => sample.id === "paste-demo-counselor");
    const items: LabSample[] = [];
    if (classNotice) {
      items.push({
        id: "sample-class",
        title: "班级群：通知夹在闲聊里",
        summary: "3 条任务 · 1 条日期待确认 · 会过滤饭局和笔记",
        role: classNotice.role,
        sourceType: classNotice.sourceType,
        body: classNotice.body,
        doNotExtract: classNotice.doNotExtract,
      });
    }
    if (studentPaste) {
      items.push({
        id: "sample-cet4",
        title: "四级报名：截止就在今晚",
        summary: "1 条任务 · 闲聊与知识分享不会生成待办",
        role: studentPaste.role,
        sourceType: studentPaste.sourceType,
        body: studentPaste.body,
        doNotExtract: studentPaste.doNotExtract,
      });
    }
    if (counselorPaste) {
      items.push({
        id: "sample-winter-run",
        title: "辅导员邮件：长跑名单报送",
        summary: "1 条任务 · 明确日期会从原文落地",
        role: counselorPaste.role,
        sourceType: counselorPaste.sourceType,
        body: counselorPaste.body,
        doNotExtract: counselorPaste.doNotExtract,
      });
    }
    return items;
  }, []);

  const [inputMode, setInputMode] = useState<LabInputMode>("sample");
  const [sampleId, setSampleId] = useState(samples[0]?.id ?? "");
  const [customBody, setCustomBody] = useState("");
  const [customRole, setCustomRole] = useState<Role>(role);
  const [customSource, setCustomSource] = useState<SourceType>("wechat_group");
  const [phase, setPhase] = useState<LabRunPhase>("idle");
  const [stages, setStages] = useState<Record<LabStageId, LabStageState>>(() => initialStages());
  const [logs, setLogs] = useState<LabLogEntry[]>([]);
  const [result, setResult] = useState<LabResult | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const logListRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setCustomRole(role);
  }, [role]);

  useEffect(() => {
    const list = logListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [logs]);

  const sample = samples.find((item) => item.id === sampleId) ?? samples[0];
  const draftBody = inputMode === "sample" ? sample?.body ?? "" : customBody;
  const draftRole = inputMode === "sample" ? sample?.role ?? role : customRole;
  const draftSource = inputMode === "sample" ? sample?.sourceType ?? "wechat_group" : customSource;
  const running = phase === "running";
  const completedCount = STAGES.filter((stage) => stages[stage.id].status === "done").length;
  const progress = Math.round((completedCount / STAGES.length) * 100);
  const localOnlyHint = /本地拆解仅支持|在线拆解尚未启用|cloud_agent_not_enabled/.test(error);
  const statusHeadline = phase === "idle"
    ? "等待原料"
    : phase === "running"
      ? "流水线运行中"
      : phase === "failed"
        ? "本次运行中断"
        : result?.mode === "cloud_agent"
          ? "在线拆解完成"
          : "样例拆解完成";
  const statusSubline = phase === "idle"
    ? "选择样例或写一条通知，启动流水线。"
    : phase === "running"
      ? "步骤会跟随真实请求和核对结果更新。"
      : phase === "failed"
        ? "查看日志和错误提示后重试。"
        : "结果可先查看，再决定是否写入收件箱。";

  function appendLog(text: string, tone: LabTone = "info") {
    setLogs((previous) => [
      ...previous,
      { id: (previous[previous.length - 1]?.id ?? 0) + 1, time: nowText(), text, tone },
    ]);
  }

  function setStage(id: LabStageId, patch: Partial<LabStageState>) {
    setStages((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  }

  function resetRun() {
    if (running) return;
    setPhase("idle");
    setStages(initialStages());
    setLogs([]);
    setResult(null);
    setError("");
    setSaved(false);
  }

  function chooseMode(next: LabInputMode) {
    if (running || next === inputMode) return;
    setInputMode(next);
    resetRun();
  }

  function chooseSample(id: string) {
    if (running) return;
    setSampleId(id);
    resetRun();
  }

  async function run() {
    if (running) return;
    const body = inputMode === "sample" ? sample?.body ?? "" : customBody.trim();
    if (!body) {
      setError("请先选择样例或输入一条通知。");
      return;
    }
    if (body.length > 12000) {
      setError("通知原文超过 12000 字，请缩短后再试。");
      return;
    }
    const runRole = inputMode === "sample" ? sample?.role ?? role : customRole;
    const runSource = inputMode === "sample" ? sample?.sourceType ?? "wechat_group" : customSource;
    const doNotExtract = inputMode === "sample" ? sample?.doNotExtract : undefined;

    setPhase("running");
    setResult(null);
    setError("");
    setSaved(false);
    setLogs([]);
    setStages({
      ...initialStages(),
      ingest: { status: "done", note: `已接收 ${body.length} 字原文` },
      request: { status: "active", note: "检查字段与正文长度" },
    });
    appendLog(`接收 ${roleLabel(runRole)}的${sourceLabels[runSource]}原文，共 ${body.length} 字。`);
    await nextPaint();

    setStage("request", { status: "done", note: "四个字段与长度检查通过" });
    setStage("agent", { status: "active", note: "等待拆解服务返回" });
    appendLog("请求门闸通过，已发送到同源拆解函数。");

    const startedAt = performance.now();
    try {
      const extracted = await extractTasks(
        { role: runRole, today, sourceType: runSource, body, images: [] },
        { doNotExtract },
      );
      const elapsedMs = Math.round(performance.now() - startedAt);
      const modeName = modeLabel(extracted.mode);
      const requestMs = extracted.trace?.requestMs ?? elapsedMs;
      const returned = extracted.trace?.returnedTasks ?? extracted.tasks.length;

      setStage("agent", {
        status: "done",
        note: `${modeName} · 返回 ${returned} 条`,
        durationMs: requestMs,
      });
      appendLog(
        `${modeName} 返回 ${returned} 条候选，请求耗时 ${Math.round(requestMs)} ms。`,
        extracted.mode === "cloud_agent" ? "ok" : "info",
      );

      const verification = verifyLabResult(body, extracted.tasks, extracted.imageReads);

      setStage("quotes", { status: "active", note: "逐条回查原文位置" });
      appendLog("开始回查每条任务的原文摘录。");
      await pause(220);
      setStage("quotes", {
        status: "done",
        note: `${verification.quoteOk}/${verification.total} 条摘录可连续定位`,
      });
      appendLog(
        verification.quoteBroken > 0
          ? `原文对账发现 ${verification.quoteBroken} 条摘录不能连续定位，已降级为待确认。`
          : `原文对账完成：${verification.quoteOk}/${verification.total} 条摘录可连续定位。`,
        verification.quoteBroken > 0 ? "fail" : "ok",
      );

      setStage("dates", { status: "active", note: "核对截止日期的原文依据" });
      appendLog("开始核对截止日期与原文时间表述。");
      await pause(200);
      setStage("dates", {
        status: "done",
        note: `${verification.dated} 个明确日期 · ${verification.needsConfirm} 条待确认`,
      });
      appendLog(
        `日期落地完成：${verification.dated} 个明确日期，${verification.needsConfirm} 条待确认。`,
        verification.needsConfirm > 0 ? "info" : "ok",
      );

      setStage("assemble", { status: "active", note: "合并并装配待办" });
      await pause(180);
      const notice = pasteImportAdapter.ingest({
        role: runRole,
        sourceType: runSource,
        sourceLabel: `流水线试跑 · ${sourceLabels[runSource]}`,
        body,
      });
      const title = extracted.tasks[0]?.title ?? notice.title;
      const tasks = extracted.tasks.map((task) => ({ ...task, noticeId: notice.id, origin: extracted.mode }));
      setStage("assemble", {
        status: "done",
        note: `${returned} 条候选 → ${tasks.length} 条待办`,
        durationMs: extracted.trace?.gateMs,
      });
      appendLog("装配完成；确认后可写入通知收件箱。", "ok");
      setResult({
        notice: { ...notice, title: title.slice(0, 42) },
        mode: extracted.mode,
        tasks,
        verification,
        trace: extracted.trace,
        elapsedMs,
      });
      setPhase("done");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "拆解失败，请稍后重试。";
      setStage("agent", { status: "failed", note: "未返回可用结果" });
      appendLog(`拆解中断：${message}`, "fail");
      setError(message);
      setPhase("failed");
    }
  }

  function saveResult() {
    if (!result || saved) return;
    onSave(result.notice, result.tasks, result.mode);
    setSaved(true);
    appendLog(`结果已写入${roleLabel(result.notice.role)}通知收件箱。`, "ok");
  }

  function taskDeadlineLabel(task: Task) {
    if (task.category === "needs_confirm") return "待确认";
    if (task.category === "fyi") return "仅阅知";
    return task.deadline ? formatShortDate(task.deadline) : "待确认";
  }

  return (
    <main className="lab-page">
      <section className="lab-hero">
        <div>
          <p className="eyebrow">agent_lab · 可观察拆解</p>
          <h1>把一条通知送上流水线</h1>
          <p className="lab-lede">从群聊原文到可回查的待办。先用样例试跑，也可以写一条自己的通知；每一步都对应真实请求或门闸结果。</p>
        </div>
        <div className={`lab-status ${phase}`} aria-live="polite">
          <span className="lab-status-dot" />
          <div><strong>{statusHeadline}</strong><small>{statusSubline}</small></div>
        </div>
      </section>

      <div className="lab-top-grid">
        <section className="panel lab-input">
          <div className="panel-heading">
            <div><FlaskConical size={16} /><h2>原料与试跑</h2></div>
            <span>{inputMode === "sample" ? "已核对样例" : "自定义输入"}</span>
          </div>
          <div className="lab-input-body">
            <div className="lab-tabs" role="tablist" aria-label="选择测试输入方式">
              <button type="button" role="tab" aria-selected={inputMode === "sample"} className={inputMode === "sample" ? "active" : ""} onClick={() => chooseMode("sample")}>使用样例</button>
              <button type="button" role="tab" aria-selected={inputMode === "custom"} className={inputMode === "custom" ? "active" : ""} onClick={() => chooseMode("custom")}>自己写一条</button>
            </div>

            {inputMode === "sample" ? (
              <div className="lab-samples" aria-label="已核对测试样例">
                {samples.map((item) => (
                  <button
                    type="button"
                    className={`lab-sample ${item.id === sample?.id ? "selected" : ""}`}
                    aria-pressed={item.id === sample?.id}
                    onClick={() => chooseSample(item.id)}
                    disabled={running}
                    key={item.id}
                  >
                    <span className="lab-sample-meta"><span className="tag">{roleLabel(item.role)}</span><span>{sourceLabels[item.sourceType]}</span></span>
                    <strong>{item.title}</strong>
                    <small>{item.summary}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="lab-custom">
                <div className="lab-field-row">
                  <label className="lab-field">角色
                    <select value={customRole} onChange={(event) => setCustomRole(event.target.value as Role)} disabled={running}>
                      <option value="student">学生</option>
                      <option value="counselor">辅导员</option>
                    </select>
                  </label>
                  <label className="lab-field">来源
                    <select value={customSource} onChange={(event) => setCustomSource(event.target.value as SourceType)} disabled={running}>
                      <option value="wechat_group">班级群</option>
                      <option value="dingtalk_or_wecom">课程 / 工作群</option>
                      <option value="email">邮件</option>
                      <option value="paste">粘贴文本</option>
                    </select>
                  </label>
                </div>
                <label className="lab-field" htmlFor="lab-custom-body">通知原文
                  <textarea
                    id="lab-custom-body"
                    value={customBody}
                    onChange={(event) => setCustomBody(event.target.value)}
                    placeholder="粘贴一条新的群聊记录或邮件，运行后查看它如何经过门闸…"
                    maxLength={12000}
                    disabled={running}
                  />
                </label>
                <div className="lab-count"><span>{customBody.length} / 12000</span><span>{running ? "正在运行" : "仅本次试跑，不写入收件箱"}</span></div>
              </div>
            )}

            <p className="lab-note"><ShieldCheck size={14} />在线模式由同源函数调用 Qoder Cloud Agent，浏览器不会接触模型凭证。本地样例不会冒充在线结果。</p>
            <button type="button" className="primary-button lab-run-button" onClick={() => void run()} disabled={running || !draftBody.trim()}>
              {running ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              {running ? "流水线运行中" : "开始拆解"}
            </button>
          </div>
        </section>

        <section className="panel lab-factory">
          <div className="panel-heading">
            <div><Factory size={16} /><h2>拆解流水线</h2></div>
            <span className="lab-factory-meta">
              {result && <span className={`lab-mode-chip ${result.mode}`}>{modeLabel(result.mode)}</span>}
              <span>{completedCount}/{STAGES.length} 工位完成</span>
            </span>
          </div>
          <div className="lab-factory-body">
            <div className={`lab-conveyor ${phase}`} aria-label="流水线工位进度">
              {STAGES.map((stage) => {
                const state = stages[stage.id];
                const Icon = stage.icon;
                return (
                  <div className={`lab-node ${state.status}`} key={stage.id}>
                    <span className="lab-node-dot">
                      {state.status === "done" ? <Check size={15} /> : state.status === "failed" ? <CircleAlert size={15} /> : <Icon size={15} />}
                    </span>
                    <strong>{stage.label}</strong>
                    <small>{state.status === "done" && state.durationMs != null ? `${Math.round(state.durationMs)} ms` : stageStatusLabel(state.status)}</small>
                  </div>
                );
              })}
            </div>
            <div className="lab-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
            <div className="lab-factory-foot">
              <p>步骤来自本次真实请求的返回结果；为便于观察，核对步骤按顺序展开。</p>
              <span>{progress}%</span>
            </div>
          </div>
        </section>
      </div>

      <div className="lab-detail-grid">
        <section className="panel lab-stage-panel">
          <div className="panel-heading">
            <div><ListChecks size={16} /><h2>工位数据</h2></div>
            <span>{phase === "idle" ? "等待运行" : phase === "failed" ? "运行中断" : "本次运行"}</span>
          </div>
          <div className="lab-stage-list">
            {STAGES.map((stage, index) => {
              const state = stages[stage.id];
              return (
                <article className={`lab-stage-row ${state.status}`} key={stage.id}>
                  <div className="lab-stage-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="lab-stage-main">
                    <div className="lab-stage-head">
                      <div>
                        <h3>{stage.label}</h3>
                        <span className={`lab-stage-pill ${state.status}`}>{stageStatusLabel(state.status)}</span>
                      </div>
                      {state.durationMs != null && <small>{Math.round(state.durationMs)} ms</small>}
                    </div>
                    <p>{state.note || IDLE_NOTES[stage.id]}</p>

                    {stage.id === "ingest" && (
                      <div className="lab-readout">
                        <span>{roleLabel(draftRole)}</span>
                        <span>{sourceLabels[draftSource]}</span>
                        <span>{draftBody.length} 字</span>
                        <span>今天 {today}</span>
                      </div>
                    )}
                    {stage.id === "request" && (
                      <div className="lab-readout">
                        <span>role / today / sourceType / body</span>
                        <span>正文 ≤ 12000 字</span>
                        <span>请求 ≤ 64 KB</span>
                      </div>
                    )}
                    {stage.id === "agent" && result && (
                      <div className="lab-readout">
                        <span className={result.mode === "cloud_agent" ? "online" : ""}>{modeLabel(result.mode)}</span>
                        <span>返回 {result.trace?.returnedTasks ?? result.tasks.length} 条</span>
                        <span>{Math.round(result.trace?.requestMs ?? result.elapsedMs)} ms</span>
                      </div>
                    )}
                    {stage.id === "quotes" && result && (
                      <ul className="lab-check-list">
                        {result.verification.quotes.map((item) => (
                          <li className={item.ok ? "ok" : "broken"} key={item.taskId}>
                            {item.ok ? <Check size={13} /> : <CircleAlert size={13} />}
                            <span>{item.title}</span>
                            <small>{item.ok ? `原文 ${item.start}–${item.end}` : "未找到连续摘录"}</small>
                          </li>
                        ))}
                        {result.tasks.length === 0 && <li className="muted">本次没有返回任务。</li>}
                      </ul>
                    )}
                    {stage.id === "dates" && result && (
                      <ul className="lab-check-list">
                        {result.verification.deadlines.map((item) => (
                          <li className={item.confirmed ? "ok" : "warn"} key={item.taskId}>
                            {item.confirmed ? <CalendarCheck2 size={13} /> : <CircleAlert size={13} />}
                            <span>{item.title}</span>
                            <small>{item.confirmed ? `${item.deadlineText ?? "原文时间"} → ${formatShortDate(item.deadline)}` : `${item.deadlineText ?? "无明确时间"} · 待确认`}</small>
                          </li>
                        ))}
                        {result.tasks.length === 0 && <li className="muted">本次没有可落地日期的任务。</li>}
                      </ul>
                    )}
                    {stage.id === "assemble" && result && (
                      <div className="lab-readout">
                        <span>门闸前 {result.trace?.returnedTasks ?? result.tasks.length}</span>
                        <span>门闸后 {result.tasks.length}</span>
                        <span>待确认 {result.verification.needsConfirm}</span>
                        <span>仅阅知 {result.verification.fyi}</span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="panel lab-log-panel">
          <div className="panel-heading">
            <div><Activity size={16} /><h2>流水线日志</h2></div>
            <span>{logs.length} 条</span>
          </div>
          <ol className="lab-logs" ref={logListRef} aria-live="polite">
            {logs.length === 0 ? (
              <li className="lab-log-empty">运行后，这里按时间记录真实请求、模式和门闸结果。</li>
            ) : logs.map((entry) => (
              <li className={`lab-log-entry ${entry.tone}`} key={entry.id}>
                <span className="lab-log-time">{entry.time}</span>
                <span className="lab-log-text">{entry.text}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      {error && (
        <section className="panel lab-outcome lab-outcome-failed" role="alert">
          <div className="lab-outcome-head">
            <div>
              <p className="eyebrow">interrupted</p>
              <h2>本次没有产出可写入的任务</h2>
              <p className="lab-error-text">{error}</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => { chooseMode("sample"); setError(""); }} disabled={running}>换成已核对样例</button>
          </div>
          {localOnlyHint && <p className="lab-hint">本地函数目前只识别三段已核对样例。原创群聊或邮件需要 Qoder Cloud Agent 在线能力；它在服务端运行，开启后可在这里直接重试。</p>}
        </section>
      )}

      {result && (
        <section className="panel lab-outcome">
          <div className="lab-outcome-head">
            <div>
              <p className="eyebrow">output</p>
              <h2>{result.tasks.length > 0 ? `${result.tasks.length} 条任务完成装配` : "本次没有需要行动的任务"}</h2>
              <p>{modeLabel(result.mode)} · 请求与门闸共 {Math.round(result.elapsedMs)} ms · {saved ? "已写入通知收件箱。" : "当前仅为试跑结果，尚未写入收件箱。"}</p>
            </div>
            <div className="lab-outcome-actions">
              {saved && onOpenResult && (
                <button type="button" className="secondary-button" onClick={() => onOpenResult(result.notice.id, result.tasks[0]?.id)}>去通知查看</button>
              )}
              <button type="button" className="primary-button" onClick={saveResult} disabled={saved || result.tasks.length === 0}>
                {saved ? <Check size={16} /> : <Inbox size={16} />}
                {saved ? "已写入" : "写入通知收件箱"}
              </button>
            </div>
          </div>

          {result.tasks.length === 0 ? (
            <p className="lab-empty">门闸后没有剩下可执行事项。闲聊、知识分享和重复澄清都会被过滤。</p>
          ) : (
            <div className="lab-output-grid">
              {result.tasks.map((task, index) => (
                <article className={`lab-output-task ${task.category}`} key={task.id}>
                  <div className="lab-output-top">
                    <span className="lab-output-index">{String(index + 1).padStart(2, "0")}</span>
                    <h3>{task.title}</h3>
                  </div>
                  <div className="lab-output-badges">
                    <span className={`badge ${task.category === "needs_confirm" ? "amber" : task.category === "fyi" ? "neutral" : "green"}`}>
                      {taskDeadlineLabel(task)}
                    </span>
                    <span className={`lab-origin ${result.mode}`}>{modeLabel(result.mode)}</span>
                  </div>
                  <p className="lab-output-action">{task.action}</p>
                  <blockquote className="lab-output-quote">{task.sourceQuote}</blockquote>
                  <div className="lab-output-meta">
                    <span>原文位置 {task.sourceStart ?? "—"}–{task.sourceEnd ?? "—"}</span>
                    <span>{task.deadlineText ?? "无原文时间"}</span>
                  </div>
                  {task.materials.length > 0 && <p className="lab-output-materials">材料：{task.materials.join("、")}</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
