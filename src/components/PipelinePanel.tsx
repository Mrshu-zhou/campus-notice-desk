import { useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  CalendarCheck2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CloudOff,
  Inbox,
  ListChecks,
  LoaderCircle,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { formatShortDate } from "../lib/tasks";
import {
  IDLE_STAGE_NOTES,
  PIPELINE_STAGES,
  pipelineModeLabel,
  stageStatusLabel,
  type PipelineLogEntry,
  type PipelineRun,
} from "../lib/pipeline";

const STAGE_ICONS = {
  ingest: Inbox,
  request: ShieldCheck,
  agent: Sparkles,
  quotes: ScanText,
  dates: CalendarCheck2,
  assemble: ListChecks,
} as const;

interface Props {
  run: PipelineRun;
  expanded: boolean;
  onToggle: () => void;
  onRetry?: () => void;
  onUseOffline?: () => void;
  retryDisabled?: boolean;
}

function durationLabel(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

function sourceLabel(run: PipelineRun) {
  return run.source === "demo" ? "内置演示" : "手动测试";
}

function statusHeadline(run: PipelineRun) {
  if (run.phase === "idle") return "待机";
  if (run.phase === "running") return "正在整理";
  if (run.phase === "failed") return "本次整理中断";
  return "本次整理完成";
}

function summaryLine(run: PipelineRun) {
  if (run.phase === "idle") {
    return run.source === "demo"
      ? "点右侧「班长发来通知」，六道工位会随真实请求逐站更新。"
      : "这次手动测试已完成，展开可查看每个工位和原文核对结果。";
  }
  if (run.phase === "failed") return "本次运行中断，未写入任何结果。";
  if (run.phase === "running") return run.logs.at(-1)?.text ?? "正在等待同源函数返回。";
  if (run.summary) return `${pipelineModeLabel(run.mode)} · ${run.summary}。`;
  return `${pipelineModeLabel(run.mode)} · ${run.taskCount} 条待办已写入当前通知。`;
}

function LogEntries({ logs }: { logs: PipelineLogEntry[] }) {
  return (
    <>
      {logs.length === 0 ? (
        <li className="notice-trace-log-empty">运行后，这里按时间记录真实请求、模式和门闸结果。</li>
      ) : logs.map((entry) => (
        <li className={`lab-log-entry ${entry.tone}`} key={entry.id}>
          <span className="lab-log-time">{entry.time}</span>
          <span className="lab-log-text">{entry.text}</span>
        </li>
      ))}
    </>
  );
}

export function PipelinePanel({ run, expanded, onToggle, onRetry, onUseOffline, retryDisabled = false }: Props) {
  const detailId = useId();
  const logListRef = useRef<HTMLOListElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (run.phase !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run.phase, run.startedAt]);

  useEffect(() => {
    if (!expanded) return;
    const list = logListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [expanded, run.logs.length]);

  const completedCount = PIPELINE_STAGES.filter((stage) => run.stages[stage.id].status === "done").length;
  const progress = Math.round((completedCount / PIPELINE_STAGES.length) * 100);
  const elapsedMs = run.phase === "running" ? now - run.startedAt : run.elapsedMs;
  const failed = run.phase === "failed";

  return (
    <section className={`notice-trace ${run.phase}`} aria-label="这条通知的拆解流水线">
      <header className="notice-trace-head">
        <div className="notice-trace-heading">
          <Activity size={15} />
          <div>
            <strong>拆解流水线</strong>
            <small>{sourceLabel(run)} · {statusHeadline(run)}</small>
          </div>
        </div>
        <div className="notice-trace-meta">
          {expanded && run.mode && <span className={`lab-mode-chip ${run.mode}`}>{pipelineModeLabel(run.mode)}</span>}
          {expanded && <span className={`notice-trace-state ${run.phase}`}>{completedCount}/{PIPELINE_STAGES.length}</span>}
          {expanded && run.phase !== "idle" && <span className="notice-trace-elapsed">{durationLabel(elapsedMs)}</span>}
          <button
            type="button"
            className="text-button notice-trace-toggle"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={onToggle}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? "收起处理过程" : "查看处理过程"}
          </button>
        </div>
      </header>

      {expanded && <div className="notice-trace-body">
        <ol className="lab-conveyor notice-trace-conveyor" aria-label="六道拆解工位">
          {PIPELINE_STAGES.map((stage) => {
            const state = run.stages[stage.id];
            const Icon = STAGE_ICONS[stage.id];
            return (
              <li className={`lab-node ${state.status}`} key={stage.id}>
                <span className="lab-node-dot">
                  {state.status === "done" ? <Check size={14} /> : state.status === "failed" ? <CircleAlert size={14} /> : state.status === "active" ? <LoaderCircle className="spin" size={14} /> : <Icon size={14} />}
                </span>
                <strong>{stage.label}</strong>
                <small>{state.status === "done" && state.durationMs != null ? durationLabel(state.durationMs) : stageStatusLabel(state.status)}</small>
              </li>
            );
          })}
        </ol>
        <div className="lab-progress notice-trace-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        <p className="notice-trace-status" aria-live="polite" title={summaryLine(run)}>{summaryLine(run)}</p>
        {run.phase === "complete" && run.mode === "local_fixture" && (
          <p className="notice-trace-hint">这是本地开发函数返回的已核对样例，本次未调用模型；在线部署会走 Cloud Agent，并标注为 cloud_agent。</p>
        )}
        {run.mode === "verified_offline" && (
          <p className="notice-trace-hint">本次按你的选择使用离线样例，智能拆解工位没有调用模型。</p>
        )}
      </div>}

      {failed && (onRetry || onUseOffline) && (
        <div className="notice-trace-actions" role="alert">
          <p>{run.error || "在线拆解没有完成，未写入任何离线结果。"}</p>
          {onUseOffline && (
            <button type="button" className="secondary-button" onClick={onUseOffline}>
              <CloudOff size={14} />改用离线核对样例
            </button>
          )}
          {onRetry && (
            <button type="button" className="primary-button" onClick={onRetry} disabled={retryDisabled}>
              {retryDisabled ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}
              {retryDisabled ? "正在重试" : "重试在线拆解"}
            </button>
          )}
        </div>
      )}

      {expanded && (
        <div className="notice-trace-detail" id={detailId}>
          <div className="notice-trace-stages">
            {PIPELINE_STAGES.map((stage, index) => {
              const state = run.stages[stage.id];
              return (
                <article className={`lab-stage-row ${state.status}`} key={stage.id}>
                  <div className="lab-stage-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="lab-stage-main">
                    <div className="lab-stage-head">
                      <div>
                        <h3>{stage.label}</h3>
                        <span className={`lab-stage-pill ${state.status}`}>{stageStatusLabel(state.status)}</span>
                      </div>
                      {state.durationMs != null && <small>{durationLabel(state.durationMs)}</small>}
                    </div>
                    <p>{state.note || IDLE_STAGE_NOTES[stage.id]}</p>

                    {stage.id === "ingest" && (
                      <div className="lab-readout">
                        <span>{run.roleLabel}</span>
                        <span>{run.sourceLabel}</span>
                        <span>{run.bodyLength} 字</span>
                        <span>今天 {run.today}</span>
                      </div>
                    )}
                    {stage.id === "request" && (
                      <div className="lab-readout">
                        <span>role / today / sourceType / body</span>
                        <span>正文 ≤ 12000 字</span>
                        <span>同源请求 ≤ 64 KB</span>
                      </div>
                    )}
                    {stage.id === "agent" && run.mode && (
                      <div className="lab-readout">
                        <span className={run.mode === "cloud_agent" ? "online" : ""}>{pipelineModeLabel(run.mode)}</span>
                        <span>返回 {run.returnedTasks} 条</span>
                      </div>
                    )}
                    {stage.id === "quotes" && run.verification && (
                      <ul className="lab-check-list">
                        {run.verification.quotes.map((item) => (
                          <li className={item.ok ? "ok" : "broken"} key={item.taskId}>
                            {item.ok ? <Check size={12} /> : <CircleAlert size={12} />}
                            <span>{item.title}</span>
                            <small>{item.ok ? `原文 ${item.start}–${item.end}` : "未找到连续摘录"}</small>
                          </li>
                        ))}
                        {run.verification.total === 0 && <li className="muted">本次没有返回任务。</li>}
                      </ul>
                    )}
                    {stage.id === "dates" && run.verification && (
                      <ul className="lab-check-list">
                        {run.verification.deadlines.map((item) => (
                          <li className={item.confirmed ? "ok" : "warn"} key={item.taskId}>
                            {item.confirmed ? <CalendarCheck2 size={12} /> : <CircleAlert size={12} />}
                            <span>{item.title}</span>
                            <small>{item.confirmed ? `${item.deadlineText ?? "原文时间"} → ${formatShortDate(item.deadline)}` : `${item.deadlineText ?? "无明确时间"} · 待确认`}</small>
                          </li>
                        ))}
                        {run.verification.total === 0 && <li className="muted">本次没有可落地日期的任务。</li>}
                      </ul>
                    )}
                    {stage.id === "assemble" && run.verification && (
                      <div className="lab-readout">
                        <span>门闸前 {run.returnedTasks}</span>
                        <span>{run.summary || `写入 ${run.taskCount}`}</span>
                        <span>待确认 {run.verification.needsConfirm}</span>
                        <span>仅阅知 {run.verification.fyi}</span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="notice-trace-logs-wrap">
            <div className="notice-trace-log-head">
              <span>运行日志</span>
              <small>{run.logs.length} 条</small>
            </div>
            <ol className="notice-trace-logs" ref={logListRef} aria-live="polite">
              <LogEntries logs={run.logs} />
            </ol>
          </aside>
        </div>
      )}
    </section>
  );
}
