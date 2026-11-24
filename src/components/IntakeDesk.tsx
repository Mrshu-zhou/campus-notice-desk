import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ClipboardPaste,
  ImagePlus,
  Info,
  LoaderCircle,
  MessageSquareText,
  ScanText,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
} from "lucide-react";
import { SourcePhone } from "./SourcePhone";
import { extractTasks } from "../lib/extraction";
import { describeImageFailures, extractTasksByImage } from "../lib/multi-image-extraction";
import { INTAKE_SOURCE_LABELS, emptyIntakeDraft, type IntakeSession } from "../lib/intake";
import { assertImageBudget, addDemoScreenshot, DEMO_SCREENSHOT_ID, DEMO_SCREENSHOT_NAME, imageDataUrl, loadImageFromUrl, MAX_IMAGES, sourceImageFromFile } from "../lib/images";
import { verifyLabResult } from "../lib/agent-lab";
import { appendPipelineLog, createPipelineRun, patchPipelineStage, pipelineModeLabel, type DemoPhase, type PipelineRun } from "../lib/pipeline";
import { preflightExtractionBudget } from "../lib/request-budget";
import { buildReviewNotice } from "../lib/review";
import { localDateString } from "../lib/tasks";
import { demoLoadTourEvent, type TourEvent } from "../lib/judge";
import type { Notice, Role, SourceImage, SourceType, Task } from "../types";

interface Props {
  role: Role;
  today: string;
  existingTasks: Task[];
  sourceNotice?: Notice;
  demoPhase: DemoPhase;
  busy: boolean;
  demoSignal: number;
  focusSignal: number;
  resetSignal: number;
  onSimulate: () => void;
  onManualTest: () => void;
  onReview: (session: IntakeSession) => void;
  onTourEvent?: (event: TourEvent) => void;
  onToast: (message: string) => void;
}

type Tab = "intake" | "sim";

const SOURCE_OPTIONS: Array<{ id: SourceType; label: string }> = [
  { id: "wechat_group", label: "班级群" },
  { id: "dingtalk_or_wecom", label: "课程 / 工作群" },
  { id: "email", label: "邮件" },
  { id: "paste", label: "其他文字" },
];

export function IntakeDesk({
  role,
  today,
  existingTasks,
  sourceNotice,
  demoPhase,
  busy,
  demoSignal,
  focusSignal,
  resetSignal,
  onSimulate,
  onManualTest,
  onReview,
  onTourEvent,
  onToast,
}: Props) {
  const [tab, setTab] = useState<Tab>("intake");
  const [draftRole, setDraftRole] = useState<Role>(role);
  const [sourceType, setSourceType] = useState<SourceType>("wechat_group");
  const [segments, setSegments] = useState<string[]>([]);
  const [pending, setPending] = useState("");
  const [images, setImages] = useState<SourceImage[]>([]);
  const [running, setRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [batchCleared, setBatchCleared] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef(images);
  const resetRef = useRef(resetSignal);
  const demoRef = useRef(demoSignal);
  const focusRef = useRef(focusSignal);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    setDraftRole(role);
  }, [role]);

  useEffect(() => {
    if (resetSignal === resetRef.current) return;
    resetRef.current = resetSignal;
    const empty = emptyIntakeDraft();
    setSegments(empty.segments);
    setPending(empty.pending);
    setImages(empty.images);
    setError("");
    setBatchCleared(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }, [resetSignal]);

  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const loadDemoScreenshot = async (source: "auto" | "manual" = "manual") => {
    if (running) return;
    const current = imagesRef.current;
    if (!current.some((image) => image.id === DEMO_SCREENSHOT_ID || image.name === DEMO_SCREENSHOT_NAME)
      && current.length >= MAX_IMAGES) {
      setError(`一次最多添加 ${MAX_IMAGES} 张截图。`);
      return;
    }
    try {
      const image = await loadImageFromUrl("/demo/lab-safety-notice.png", DEMO_SCREENSHOT_NAME, { id: DEMO_SCREENSHOT_ID });
      setImages((existing) => addDemoScreenshot(existing, image));
      setTab("intake");
      setBatchCleared(false);
      const event = demoLoadTourEvent(source);
      if (event) onTourEvent?.(event);
      const reused = imagesRef.current.some((item) => item.id === DEMO_SCREENSHOT_ID || item.name === DEMO_SCREENSHOT_NAME);
      onToast(reused ? "演示截图已存在，直接复用这张。" : "已载入一张虚构的校园通知截图，可直接整理。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "演示截图加载失败。");
    }
  };

  useEffect(() => {
    if (demoSignal === demoRef.current) return;
    demoRef.current = demoSignal;
    setTab("intake");
    void loadDemoScreenshot("auto");
  }, [demoSignal]);

  useEffect(() => {
    if (focusSignal === focusRef.current) return;
    focusRef.current = focusSignal;
    setTab("intake");
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [focusSignal]);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setError("");
    const next = [...images];
    for (const file of list) {
      if (next.length >= MAX_IMAGES) {
        setError(`一次最多添加 ${MAX_IMAGES} 张截图，多出的图片未加入。`);
        break;
      }
      try {
        next.push(await sourceImageFromFile(file));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "这张图片无法添加。");
      }
    }
    try {
      assertImageBudget(next);
      setImages(next);
      setBatchCleared(false);
      onTourEvent?.("draft-ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "截图总大小过大。");
    }
  };

  const hasFileDrag = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    if (!running && images.length < MAX_IMAGES) setDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = running || images.length >= MAX_IMAGES ? "none" : "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    setDragActive(false);
    if (running) {
      setError("正在整理当前草稿，完成后再添加截图。");
      return;
    }
    if (images.length >= MAX_IMAGES) {
      setError(`一次最多添加 ${MAX_IMAGES} 张截图。`);
      return;
    }
    if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
  };

  const addSegment = () => {
    const text = pending.trim();
    if (!text) return;
    const next = [...segments, text];
    if ([...next, ""].join("\n\n").length > 12_000) {
      setError("文字总长度不能超过 12000 字，请删减后再添加。");
      return;
    }
    setSegments(next);
    setPending("");
    setError("");
    setBatchCleared(false);
    onTourEvent?.("draft-ready");
  };

  const removeSegment = (index: number) => {
    setSegments((current) => current.filter((_, at) => at !== index));
  };

  const submit = async () => {
    if (running) return;
    const pendingText = pending.trim();
    const allSegments = pendingText ? [...segments, pendingText] : segments;
    const body = allSegments.join("\n\n");
    if (!body.trim() && images.length === 0) {
      setError("先粘贴通知文字或添加截图，再开始整理。");
      return;
    }
    if (body.length > 12_000) {
      setError("文字总长度不能超过 12000 字，请删减后再整理。");
      return;
    }
    const budgetError = preflightExtractionBudget({
      body,
      images: images.map(({ id, mediaType, data }) => ({ id, mediaType, data })),
    });
    if (budgetError) {
      setError(budgetError);
      return;
    }
    try {
      assertImageBudget(images);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "截图总大小过大。");
      return;
    }

    setRunning(true);
    setError("");
    const startedAt = Date.now();
    try {
      const result = await extractTasksByImage(
        {
          role: draftRole,
          today: localDateString(),
          sourceType,
          body,
          images: images.map(({ id, mediaType, data }) => ({ id, mediaType, data })),
        },
        {
          existingTasks,
          keepExistingDuplicates: true,
          imageLabels: Object.fromEntries(images.map((image, index) => [image.id, image.name || `第 ${index + 1} 张截图`])),
        },
        extractTasks,
      );
      const returned = result.trace?.returnedTasks ?? result.tasks.length;
      const sourceLabel = INTAKE_SOURCE_LABELS[sourceType];
      const notice = buildReviewNotice({
        role: draftRole,
        sourceType,
        sourceLabel,
        segments: allSegments,
        images,
        imageReads: result.imageReads,
        ignored: result.ignored,
        mode: result.mode,
        returned,
        accepted: result.tasks.length,
        titleHint: result.tasks[0]?.title,
      });
      const tasks = result.tasks.map((task) => ({ ...task, noticeId: notice.id }));
      const verification = verifyLabResult(body, tasks, result.imageReads);
      const requestMs = Math.round(result.trace?.requestMs ?? Date.now() - startedAt);
      let run: PipelineRun = createPipelineRun({
        noticeId: notice.id,
        source: "manual",
        role: draftRole,
        sourceType,
        roleLabel: draftRole === "student" ? "学生" : "辅导员",
        sourceLabel,
        bodyLength: body.length,
        today,
        startedAt,
      });
      run = patchPipelineStage(run, "ingest", { status: "done", note: `收集 ${allSegments.length} 段文字、${images.length} 张截图` });
      run = patchPipelineStage(run, "request", { status: "done", note: "文字长度、来源与图片格式检查通过" });
      run = patchPipelineStage(run, "agent", { status: "done", note: `${pipelineModeLabel(result.mode)} · 返回 ${returned} 条`, durationMs: requestMs });
      run = patchPipelineStage(run, "quotes", { status: "done", note: `${verification.quoteOk}/${verification.total} 条摘录可连续定位` });
      run = patchPipelineStage(run, "dates", { status: "done", note: `${verification.dated} 个明确日期 · ${verification.needsConfirm} 条待确认` });
      run = patchPipelineStage(run, "assemble", { status: "done", note: `${returned} 条候选 → ${tasks.length} 条可核对候选`, durationMs: result.trace?.gateMs });
      run = {
        ...run,
        phase: "complete",
        mode: result.mode,
        verification,
        returnedTasks: returned,
        taskCount: tasks.length,
        elapsedMs: Math.round(Date.now() - startedAt),
        error: "",
      };
      run = appendPipelineLog(run, `整理 ${allSegments.length} 段文字、${images.length} 张截图。`);
      run = appendPipelineLog(run, "请求门闸通过，已发送到同源拆解函数。");
      run = appendPipelineLog(run, `${pipelineModeLabel(result.mode)} 返回 ${returned} 条候选，请求耗时 ${requestMs} ms。`, result.mode === "cloud_agent" ? "ok" : "info");
      run = appendPipelineLog(run, `原文对账：${verification.quoteOk}/${verification.total} 条摘录可连续定位。`, verification.quoteBroken > 0 ? "fail" : "ok");
      run = appendPipelineLog(run, `日期落地：${verification.dated} 个明确日期，${verification.needsConfirm} 条待确认。`, verification.needsConfirm > 0 ? "info" : "ok");
      if (result.imageFailures.length > 0) {
        run = appendPipelineLog(run, describeImageFailures(result.imageFailures), "fail");
      }
      run = appendPipelineLog(run, "候选已就绪，等待你核对后加入待办。", "ok");

      onTourEvent?.("draft-ready");
      onReview({
        role: draftRole,
        sourceType,
        sourceLabel,
        segments: allSegments,
        images,
        notice,
        tasks,
        imageReads: result.imageReads,
        ignored: result.ignored,
        mode: result.mode,
        returned,
        run,
        imageFailures: result.imageFailures,
      });
      setRunning(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "整理失败，请稍后重试。");
      setRunning(false);
    }
  };

  const pendingVisible = pending.trim();
  const segmentCount = segments.length + (pendingVisible ? 1 : 0);
  const localPreview = ["127.0.0.1", "localhost"].includes(window.location.hostname);

  return (
    <aside className="sim-pane intake-pane" aria-label="添加并整理通知">
      <header className="intake-head" data-tour="intake-heading">
        <div>
          <span className="intake-kicker">在线测试</span>
          <h2>整理我的通知</h2>
        </div>
        <div className="intake-tabs" role="tablist" aria-label="右侧面板">
          <button type="button" role="tab" aria-selected={tab === "intake"} className={tab === "intake" ? "active" : ""} onClick={() => setTab("intake")}>
            <ClipboardPaste size={13} />添加通知
          </button>
          <button type="button" role="tab" aria-selected={tab === "sim"} className={tab === "sim" ? "active" : ""} onClick={() => setTab("sim")}>
            <MessageSquareText size={13} />模拟消息
          </button>
        </div>
      </header>

      {tab === "intake" ? (
        <>
          <div className="intake-scroll" data-tour="intake" ref={scrollRef}>
            {batchCleared && (
              <p className="intake-reset-note">
                <Info size={13} />
                上一批已保存，文字和截图草稿已清空；可以继续添加通知。
              </p>
            )}
            {localPreview && (
              <p className="intake-local-note">
                <Info size={13} />
                本地预览只把内置演示截图和三段已核对文字作为 local_fixture 样例送进确认页；其它文字或截图会明确失败，不会伪造在线拆解。在线拆解由公开站点的 Cloud Agent 负责。
              </p>
            )}
            <section className="intake-card">
              <div className="intake-source-row">
                <label>
                  <span>整理给谁</span>
                  <select value={draftRole} onChange={(event) => setDraftRole(event.target.value as Role)} disabled={running}>
                    <option value="student">学生</option>
                    <option value="counselor">辅导员</option>
                  </select>
                </label>
                <label>
                  <span>通知来自</span>
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)} disabled={running}>
                    {SOURCE_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="intake-section">
                <div className="intake-section-head">
                  <strong>通知文字</strong>
                  <span>{segmentCount} 段 · 可连续添加</span>
                </div>
                {segments.length > 0 && (
                  <ol className="intake-segments">
                    {segments.map((segment, index) => (
                      <li key={`${index}-${segment.slice(0, 8)}`}>
                        <span>第 {index + 1} 段</span>
                        <p>{segment}</p>
                        <button type="button" className="icon-button" onClick={() => removeSegment(index)} disabled={running} aria-label={`删除第 ${index + 1} 段`}><Trash2 size={14} /></button>
                      </li>
                    ))}
                  </ol>
                )}
                <textarea
                  ref={textareaRef}
                  value={pending}
                  onChange={(event) => setPending(event.target.value)}
                  placeholder="从班级群、邮件里复制通知文字，粘贴到这里；也可以分成多段逐段加入。"
                  maxLength={12_000}
                  disabled={running}
                  rows={5}
                />
                <div className="intake-text-tools">
                  <span>{pending.length} 字</span>
                  <button type="button" className="secondary-button compact-button" onClick={addSegment} disabled={!pending.trim() || running}>
                    <ClipboardPaste size={14} />加入草稿
                  </button>
                </div>
              </div>

              <div
                className={`intake-section intake-dropzone ${dragActive ? "dragging" : ""}`}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="intake-section-head">
                  <strong>通知截图</strong>
                  <span>{images.length} / {MAX_IMAGES} 张</span>
                </div>
                {images.length > 0 && (
                  <div className="intake-thumbs">
                    {images.map((image) => (
                      <figure key={image.id}>
                        <img src={imageDataUrl(image)} alt={image.name ?? "待识别截图"} />
                        <button type="button" className="icon-button intake-thumb-remove" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))} disabled={running} aria-label="移除这张截图"><Trash2 size={13} /></button>
                        <figcaption>{image.name ?? "截图"}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                <div className="intake-image-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    hidden
                    onChange={(event) => {
                      if (event.target.files) void addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                  <button type="button" className="secondary-button compact-button" onClick={() => fileInputRef.current?.click()} disabled={running || images.length >= MAX_IMAGES}>
                    <ImagePlus size={14} />添加截图
                  </button>
                  <span>PNG / JPEG / WebP，最多 4 张 · <span className="intake-drop-hint">也可直接拖入</span></span>
                </div>
                <p className="intake-hint">
                  <ScanText size={13} />
                  截图会逐张读出文字；模糊、裁切或遮挡会标为不确定，不会假装读全。群文件附件没有出现在截图里时，仍需回原聊天软件下载。
                </p>
                {dragActive && (
                  <div className="intake-drop-overlay" role="status">
                    <UploadCloud size={20} />
                    <strong>松开即可添加截图</strong>
                  </div>
                )}
              </div>

              <button type="button" className="intake-demo-link" onClick={() => void loadDemoScreenshot("manual")} disabled={running} data-tour="intake-demo">
                <Sparkles size={13} />没有素材？载入一张虚构的演示截图
              </button>
            </section>

            <p className="intake-privacy">
              <ShieldCheck size={14} />
              {localPreview
                ? "本地预览只把样例发到本仓库 8001 端口的核对函数，返回 local_fixture，不会上传给 Cloud Agent；截图仅保存在当前浏览器，用于回看。"
                : "在线整理会把文字与截图发送到本站的 Qoder Cloud Agent；截图仅保存在当前浏览器，用于回看。凭证由平台注入服务端，不会进入前端。"}
            </p>

            {running && (
              <div className="intake-running" role="status" data-tour="intake-running">
                <LoaderCircle className="spin" size={18} />
                <div>
                  <strong>{images.length > 0 ? "正在读取截图并拆解通知" : "正在拆解通知"}</strong>
                  <span>已等待 {elapsed} 秒；截图较多时通常需要 10–75 秒。可以离开这个面板，但请不要关闭页面。</span>
                </div>
              </div>
            )}
          </div>

          <footer className="intake-submit">
            {error && <div className="error-box intake-submit-error" role="alert">{error}</div>}
            <div>
              <strong>{segmentCount} 段文字 · {images.length} 张截图</strong>
              <span>{INTAKE_SOURCE_LABELS[sourceType]} · 一次整理</span>
            </div>
            <button type="button" className="primary-button" onClick={() => void submit()} disabled={running || (!pendingVisible && segments.length === 0 && images.length === 0)} data-tour="intake-submit">
              {running ? <LoaderCircle className="spin" size={16} /> : <Wand2 size={16} />}
              {running ? "正在整理" : "整理这批通知"}
            </button>
          </footer>
        </>
      ) : (
        <div className="intake-sim">
          <SourcePhone role={role} notice={sourceNotice} phase={demoPhase} busy={busy} onSimulate={onSimulate} onManualTest={onManualTest} />
        </div>
      )}
    </aside>
  );
}