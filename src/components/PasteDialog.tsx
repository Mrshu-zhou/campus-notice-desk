import { useEffect, useState } from "react";
import { ClipboardPaste, FileJson, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { pasteImportAdapter, pasteSamples, sourceLabels } from "../data";
import { localDateString } from "../lib/tasks";
import { extractTasks } from "../lib/extraction";
import { verifyLabResult } from "../lib/agent-lab";
import {
  appendPipelineLog,
  createPipelineRun,
  pipelineModeLabel,
  type PipelineRun,
} from "../lib/pipeline";
import type { ExtractionResult, Notice, Role, SourceType, Task } from "../types";

interface Props {
  open: boolean;
  role: Role;
  existingTasks?: Task[];
  onClose: () => void;
  onImported: (notice: Notice, tasks: Task[], mode: ExtractionResult["mode"], run: PipelineRun) => void;
}

export function PasteDialog({ open, role, existingTasks = [], onClose, onImported }: Props) {
  const [body, setBody] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("wechat_group");
  const [draftRole, setDraftRole] = useState<Role>(role);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraftRole(role);
      setError("");
    }
  }, [open, role]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, running, onClose]);

  if (!open) return null;

  const chooseSample = (sampleId: string) => {
    const sample = pasteSamples.find((item) => item.id === sampleId);
    if (!sample) return;
    setBody(sample.body);
    setSourceType(sample.sourceType);
    setDraftRole(sample.role);
    setError("");
  };

  const submit = async () => {
    if (!body.trim() || running) return;
    setRunning(true);
    setError("");
    const startedAt = Date.now();
    try {
      const notice = pasteImportAdapter.ingest({
        role: draftRole,
        sourceType,
        sourceLabel: sourceType === "email" ? "手动粘贴 · 邮件" : sourceType === "wechat_group" ? "手动粘贴 · 班级群" : "手动粘贴 · 课程 / 工作群",
        body: body.trim(),
      });
      const sample = pasteSamples.find((item) => item.body.trim() === notice.body);
      const requestStartedAt = performance.now();
      const result = await extractTasks(
        { role: draftRole, today: localDateString(), sourceType, body: notice.body, images: [] },
        { noticeId: notice.id, existingTasks, doNotExtract: sample?.doNotExtract },
      );
      if (result.tasks.length === 0) {
        throw new Error("没有识别出需要行动的事项，未写入待办。闲聊或知识分享不会生成任务。");
      }
      const requestMs = Math.round(result.trace?.requestMs ?? performance.now() - requestStartedAt);
      const returned = result.trace?.returnedTasks ?? result.tasks.length;
      const tasks = result.tasks.map((task) => ({ ...task, noticeId: notice.id, origin: result.mode }));
      const verification = verifyLabResult(notice.body, result.tasks, result.imageReads);

      let run: PipelineRun = {
        ...createPipelineRun({
          noticeId: notice.id,
          source: "manual",
          role: draftRole,
          sourceType,
          roleLabel: draftRole === "student" ? "学生" : "辅导员",
          sourceLabel: sourceLabels[sourceType],
          bodyLength: notice.body.length,
          today: localDateString(),
          startedAt,
        }),
        phase: "complete",
        mode: result.mode,
        stages: {
          ingest: { status: "done", note: `已接收 ${notice.body.length} 字原文` },
          request: { status: "done", note: "四个字段、来源与长度检查通过" },
          agent: { status: "done", note: `${pipelineModeLabel(result.mode)} · 返回 ${returned} 条`, durationMs: requestMs },
          quotes: { status: "done", note: `${verification.quoteOk}/${verification.total} 条摘录可连续定位` },
          dates: { status: "done", note: `${verification.dated} 个明确日期 · ${verification.needsConfirm} 条待确认` },
          assemble: { status: "done", note: `${returned} 条候选 → ${tasks.length} 条待办`, durationMs: result.trace?.gateMs },
        },
        verification,
        returnedTasks: returned,
        taskCount: tasks.length,
        elapsedMs: Math.round(Date.now() - startedAt),
        error: "",
      };
      run = appendPipelineLog(run, `接收${sourceLabels[sourceType]}原文，共 ${notice.body.length} 字。`);
      run = appendPipelineLog(run, "请求门闸通过，已发送到同源拆解函数。");
      run = appendPipelineLog(
        run,
        `${pipelineModeLabel(result.mode)} 返回 ${returned} 条候选，请求耗时 ${requestMs} ms。`,
        result.mode === "cloud_agent" ? "ok" : "info",
      );
      run = appendPipelineLog(
        run,
        verification.quoteBroken > 0
          ? `原文对账发现 ${verification.quoteBroken} 条摘录不能连续定位，已降级为待确认。`
          : `原文对账完成：${verification.quoteOk}/${verification.total} 条摘录可连续定位。`,
        verification.quoteBroken > 0 ? "fail" : "ok",
      );
      run = appendPipelineLog(
        run,
        `日期落地完成：${verification.dated} 个明确日期，${verification.needsConfirm} 条待确认。`,
        verification.needsConfirm > 0 ? "info" : "ok",
      );
      run = appendPipelineLog(run, `装配完成：${returned} 条候选 → ${tasks.length} 条待办。`, "ok");

      onImported({ ...notice, title: (result.tasks[0]?.title ?? notice.title).slice(0, 42) }, tasks, result.mode, run);
      setBody("");
      setRunning(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "拆解失败，请稍后重试。");
      setRunning(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !running) onClose(); }}>
      <section className="modal paste-modal" role="dialog" aria-modal="true" aria-labelledby="paste-title">
        <button type="button" className="icon-button modal-close" onClick={onClose} disabled={running} aria-label="关闭手动测试"><X size={19} /></button>
        <p className="eyebrow">manual_test</p>
        <h2 id="paste-title">自己手动测试一条通知</h2>
        <p className="modal-intro">输入任何通知原文，拆解后会写入左侧通知与待办；可在通知详情里展开完整拆解流程查看每一站核对结果。</p>
        <div className="sample-grid">
          {pasteSamples.map((sample) => (
            <button type="button" className="sample-button" onClick={() => chooseSample(sample.id)} key={sample.id} disabled={running}>
              <FileJson size={17} /><span><strong>{sample.role === "student" ? "学生示例" : "辅导员示例"}</strong><small>{sample.role === "student" ? "四级报名夹在约饭和笔记中" : "报送冬季长跑名单"}</small></span>
            </button>
          ))}
        </div>
        <div className="paste-options">
          <label>导入角色<select value={draftRole} onChange={(event) => setDraftRole(event.target.value as Role)} disabled={running}><option value="student">学生</option><option value="counselor">辅导员</option></select></label>
          <label>通知来源<select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} disabled={running}><option value="wechat_group">班级群</option><option value="dingtalk_or_wecom">课程 / 工作群</option><option value="email">邮件</option></select></label>
        </div>
        <label className="paste-label" htmlFor="paste-body">通知原文</label>
        <textarea id="paste-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="在这里粘贴通知原文，最多 12000 字…" maxLength={12000} disabled={running} autoFocus />
        <div className="paste-meta"><span>{body.length} / 12000</span><span>{draftRole === "student" ? "学生" : "辅导员"}视角拆解</span></div>
        <p className="privacy-note"><ShieldCheck size={15} />在线拆解会把原文发送至 Qoder Cloud Agent，请勿包含学号、电话等敏感信息；凭证由平台注入服务端，不会进入前端。本地核对样例不会冒充在线结果。</p>
        {error && <div className="error-box" role="alert">{error}</div>}
        {running && <div className="extracting-box"><LoaderCircle className="spin" size={18} /><span><strong>正在识别并拆解</strong><small>区分正式通知、闲聊与知识分享，核对任务摘录…</small></span></div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={running}>取消</button>
          <button type="button" className="primary-button" onClick={submit} disabled={!body.trim() || running}>{running ? <LoaderCircle className="spin" size={16} /> : <ClipboardPaste size={16} />}{running ? "正在拆解" : "拆成任务"}</button>
        </div>
      </section>
    </div>
  );
}
