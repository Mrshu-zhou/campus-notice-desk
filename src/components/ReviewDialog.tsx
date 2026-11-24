import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Info,
  ListChecks,
  MapPin,
  Pencil,
  Quote,
  X,
} from "lucide-react";
import { NotificationStatus } from "./NotificationStatus";
import { findTaskRelations, type TaskRelation } from "../lib/dedupe";
import { imageDataUrl } from "../lib/images";
import { describeImageFailures } from "../lib/multi-image-extraction";
import { originCaption } from "../lib/extraction-mode";
import type { IntakeSession } from "../lib/intake";
import {
  applyReviewDecisions,
  buildReviewedTask,
  defaultCandidateDecision,
  partitionMaterials,
  type ApplyReviewOutput,
  type CandidateEdits,
} from "../lib/review";
import {
  defaultReminderLead,
  formatDateTime,
  minuteFromNow,
  normalizeChineseDateTime,
  reminderAtFor,
  reminderExplainer,
  toLocalDateTime,
} from "../lib/reminders";
import { clockFromDeadlineText, deadlineSourceNote, extractLinks, formatDeadlineLabel, normalizeClockInput } from "../lib/tasks";
import type { TourEvent } from "../lib/judge";
import type { NotificationState } from "../lib/notifications";
import type { Category, IgnoredReason, Task } from "../types";

type EditingField = "deadline" | "location" | "materials" | "requirements" | "reminder" | "text" | null;

interface RowState extends CandidateEdits {
  key: string;
  task: Task;
  relations: TaskRelation[];
  imageUncertain: boolean;
}

interface Props {
  session: IntakeSession;
  existingTasks: Task[];
  permission: NotificationState;
  onRequestPermission: () => void;
  onTestNotification: () => void;
  onTourEvent?: (event: TourEvent) => void;
  onClose: () => void;
  onConfirm: (session: IntakeSession, outcome: ApplyReviewOutput, manualSkipped: number) => void;
}

const IGNORED_LABELS: Record<IgnoredReason, string> = {
  chat: "闲聊",
  knowledge: "知识分享",
  acknowledgement: "收到 / 确认",
  duplicate: "重复",
  unrelated: "与待办无关",
  other: "其他",
};

const CATEGORY_LABELS: Record<Category, string> = {
  action: "需办理",
  needs_confirm: "待确认",
  fyi: "仅阅知",
};

const UNCERTAIN_PATTERN = /看不清|裁切|遮挡|模糊|不确定|无法确认|缺失/;

function initialRow(task: Task, existingTasks: Task[]): RowState {
  const relations = findTaskRelations(task, existingTasks);
  const decision = defaultCandidateDecision(task);
  const clock = task.deadlineClock ?? clockFromDeadlineText(task.deadlineText) ?? "";
  const materialParts = partitionMaterials(task.materials);
  const requirements = [task.requirements, ...materialParts.loginNotes].filter(Boolean).join("\n");
  const fallbackCustom = reminderAtFor(task.deadline, task.deadlineText, "2h", "", clock)
    ?? toLocalDateTime(new Date(Date.now() + 60 * 60 * 1000));
  return {
    key: task.id,
    task,
    relations,
    selected: decision.selected,
    title: task.title,
    action: task.action,
    deadline: task.deadline ?? "",
    deadlineText: task.deadlineText,
    deadlineClock: clock,
    materialsText: materialParts.materials.join("、"),
    location: task.location ?? "",
    requirements,
    relevance: decision.relevance,
    confirmActionable: false,
    relationChoice: "create_new",
    relationTaskId: relations[0]?.task.id ?? "",
    reminderLead: task.category === "action" ? defaultReminderLead(task.deadline, task.deadlineText, new Date(), clock) : "none",
    customReminderAt: fallbackCustom,
    imageUncertain: Boolean(task.sourceImageId && task.uncertainty && UNCERTAIN_PATTERN.test(task.uncertainty)),
  };
}

function buildTask(row: RowState, noticeId: string) {
  if (!row.selected || row.relevance === "not_mine") return null;
  return buildReviewedTask(row.task, row, noticeId);
}

function normalizeDeadlineInput(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  const match = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function ReviewDialog({
  session,
  existingTasks,
  permission,
  onRequestPermission,
  onTestNotification,
  onTourEvent,
  onClose,
  onConfirm,
}: Props) {
  const [rows, setRows] = useState<RowState[]>(() => session.tasks.map((task) => initialRow(task, existingTasks)));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [deadlineDraft, setDeadlineDraft] = useState("");
  const [clockDraft, setClockDraft] = useState("");
  const [deadlineError, setDeadlineError] = useState("");
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onTourEvent?.("review-open");
  }, []);

  const previews = useMemo(
    () => rows.map((row) => buildTask(row, session.notice.id)),
    [rows, session.notice.id],
  );
  const remindersPreview = useMemo(
    () => previews.map((task, index) => {
      if (!task || task.category === "fyi") return null;
      return reminderAtFor(
        task.deadline,
        task.deadlineText,
        rows[index].reminderLead,
        rows[index].customReminderAt,
        rows[index].deadlineClock,
      );
    }),
    [previews, rows],
  );

  const addable = previews.filter((task, index): task is Task => Boolean(task) && rows[index].relationChoice !== "skip").length;
  const uncertainImages = session.imageReads.filter((read) => read.uncertain).length;
  const manualSkipped = rows.filter((row) => !row.selected || row.relevance === "not_mine").length;

  const row = rows[currentIndex];
  const task = previews[currentIndex];
  const image = row?.task.sourceImageId ? session.images.find((item) => item.id === row.task.sourceImageId) : undefined;
  const evidenceOpen = row ? Boolean(openEvidence[row.key]) : false;
  const reminderAt = remindersPreview[currentIndex];
  const relation = row ? row.relations.find((item) => item.task.id === row.relationTaskId) ?? row.relations[0] : undefined;

  const patchRow = (index: number, patch: Partial<RowState>) => {
    setRows((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  };

  const chooseRelevance = (index: number, relevance: CandidateEdits["relevance"]) => {
    const isFyi = rows[index]?.task.category === "fyi";
    patchRow(index, { relevance, selected: relevance !== "not_mine" && (!isFyi || relevance === "need") });
    onTourEvent?.("decision");
  };

  const goToIndex = (next: number) => {
    if (next < 0 || next >= rows.length) return;
    setCurrentIndex(next);
    setEditingField(null);
    setDeadlineError("");
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const toggleEditor = (field: Exclude<EditingField, null>) => {
    if (!row) return;
    if (editingField === field) {
      setEditingField(null);
      setDeadlineError("");
      return;
    }
    if (field === "deadline") {
      setDeadlineDraft(row.deadline ?? "");
      setClockDraft(row.deadlineClock ?? "");
      setDeadlineError("");
    }
    setEditingField(field);
  };

  const clearDeadline = () => {
    if (!row) return;
    const reminderLead = row.reminderLead === "1d" || row.reminderLead === "2h" ? "none" : row.reminderLead;
    patchRow(currentIndex, { deadline: "", deadlineClock: "", reminderLead });
    setClockDraft("");
    setEditingField(null);
    setDeadlineError("");
  };

  const applyDeadline = () => {
    if (!row) return;
    const normalized = normalizeDeadlineInput(deadlineDraft);
    if (normalized === null) {
      setDeadlineError("日期没看懂，请写成 2026-11-26 或 2026年11月26日。");
      return;
    }
    const clock = clockDraft.trim() ? normalizeClockInput(clockDraft) : "";
    if (clock === null) {
      setDeadlineError("时间请用 24 小时制，例如 14:30；没有具体时刻可留空。");
      return;
    }
    patchRow(currentIndex, { deadline: normalized, deadlineClock: clock || null });
    setDeadlineError("");
    setEditingField(null);
  };

  const confirm = () => {
    const decisions = rows.flatMap((item) => {
      const built = buildTask(item, session.notice.id);
      if (!built) return [];
      const at = built.category === "fyi" ? null : reminderAtFor(
        built.deadline,
        built.deadlineText,
        item.reminderLead,
        item.customReminderAt,
        built.deadlineClock,
      );
      return [{
        task: built,
        relationChoice: item.relationChoice,
        relationTaskId: item.relationTaskId,
        reminderAt: at,
        reminderLead: item.reminderLead,
      }];
    });
    const outcome = applyReviewDecisions({
      noticeId: session.notice.id,
      decisions,
      existingTasks,
    });
    onTourEvent?.("saved");
    onConfirm(session, outcome, manualSkipped);
  };

  const modeCaption = originCaption(session.mode) ?? "拆解结果";
  const bodyPreview = session.segments.join("\n\n").trim();
  const rowLinks = row ? extractLinks(row.action, row.requirements, row.task.sourceQuote, bodyPreview) : [];
  const rowSourceTime = row ? deadlineSourceNote(row.deadline || null, row.deadlineText) : "";
  const deadlineChipLabel = row?.deadline
    ? formatDeadlineLabel(row.deadline, row.deadlineText, row.deadlineClock, `${row.title} ${row.action}`)
    : "未识别到日期，可手动补上";
  const reminderChipLabel = !row
    ? "设置提醒"
    : row.reminderLead === "none"
      ? "设置提醒"
      : row.reminderLead === "custom"
        ? reminderAt ? `提醒 ${formatDateTime(reminderAt)}` : "提醒时间待补"
        : !reminderAt ? "提醒时间待补" : row.reminderLead === "1d" ? "提前一天提醒" : "提前两小时提醒";

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="关闭核对窗口"><X size={18} /></button>
        <header className="review-head">
          <span className="intake-kicker">整理完成 · 请核对</span>
          <h2 id="review-title">这些事项，哪些需要你办？</h2>
          <p className="modal-intro">
            {modeCaption} · {session.sourceLabel} · 共 {rows.length} 条候选。先做决定，需要时再改细节。
          </p>
        </header>

        {uncertainImages > 0 && (
          <p className="review-warning-line">
            <AlertCircle size={14} />
            {uncertainImages} 张截图有看不清、裁切或遮挡；相关候选会先保留为待确认，请对照原图核对。
          </p>
        )}

        {session.imageFailures && session.imageFailures.length > 0 && (
          <p className="review-warning-line">
            <AlertCircle size={14} />
            {describeImageFailures(session.imageFailures)}
          </p>
        )}

        {session.ignored.length > 0 && (
          <details className="review-ignored">
            <summary><ListChecks size={14} />{session.ignored.length} 段内容没有生成待办，点开看原因</summary>
            <ul>
              {session.ignored.map((item, index) => (
                <li key={`${index}-${item.text.slice(0, 8)}`}>
                  <span className="badge neutral">{IGNORED_LABELS[item.reason]}</span>
                  <p>{item.text}</p>
                </li>
              ))}
            </ul>
          </details>
        )}

        {rows.length === 0 ? (
          <div className="review-empty">
            <Info size={22} />
            <h3>没有可行动的待办候选</h3>
            <p>这条记录里可能只有闲聊、确认或知识分享；也可以返回补充文字或换一张更完整的截图。通知本身仍会保存，方便以后回看。</p>
          </div>
        ) : row && (
          <div className="review-list" data-tour="review">
            <article
              className={`review-card ${row.relevance === "not_mine" ? "not-mine" : ""}`}
              key={row.key}
              ref={cardRef}
            >
              <div className="review-card-head">
                <div className="review-card-badges">
                  <span className={`badge ${row.relevance === "not_mine" || row.relationChoice === "skip" ? "neutral" : task?.category === "needs_confirm" ? "amber" : "green"}`}>
                    {row.relevance === "not_mine" ? "不加入" : row.relationChoice === "skip" ? "跳过" : CATEGORY_LABELS[task?.category ?? row.task.category]}
                  </span>
                  {row.task.sourceImageId && <span className="badge neutral"><ImageIcon size={11} />来自截图</span>}
                  {row.imageUncertain && <span className="badge amber"><AlertCircle size={11} />截图待核对</span>}
                </div>
                {rows.length > 1 && (
                  <div className="review-pager">
                    <button type="button" aria-label="上一条" disabled={currentIndex === 0} onClick={() => goToIndex(currentIndex - 1)}><ChevronLeft size={14} /></button>
                    <span>第 {currentIndex + 1} / {rows.length} 条</span>
                    <button type="button" aria-label="下一条" disabled={currentIndex === rows.length - 1} onClick={() => goToIndex(currentIndex + 1)}><ChevronRight size={14} /></button>
                  </div>
                )}
              </div>

              <div className="review-summary-block">
                <h3>{row.title.trim() || "未命名事项"}</h3>
                <p className="review-summary-action">{row.action.trim() || "原文没有写明具体要做什么，可以点下面的「改标题或说明」补充。"}</p>
                <p className="review-source-time">
                  <Clock3 size={12} />
                  <span>{rowSourceTime}</span>
                </p>
                {rowLinks.length > 0 && (
                  <div className="review-links">
                    {rowLinks.map((link) => (
                      <a key={link} href={link} target="_blank" rel="noreferrer noopener">
                        <ExternalLink size={12} />{link}
                      </a>
                    ))}
                  </div>
                )}
                <button type="button" className="text-button review-edit-text" onClick={() => toggleEditor("text")}>
                  <Pencil size={12} />改标题或说明
                </button>
              </div>

              {editingField === "text" && (
                <div className="review-chip-editor">
                  <div className="review-field">
                    <label htmlFor={`review-title-${row.key}`}>待办标题</label>
                    <input
                      id={`review-title-${row.key}`}
                      value={row.title}
                      maxLength={80}
                      autoFocus
                      onChange={(event) => patchRow(currentIndex, { title: event.target.value })}
                    />
                  </div>
                  <div className="review-field">
                    <label htmlFor={`review-action-${row.key}`}>要做什么</label>
                    <textarea
                      id={`review-action-${row.key}`}
                      rows={2}
                      value={row.action}
                      maxLength={500}
                      onChange={(event) => patchRow(currentIndex, { action: event.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="review-decision" role="group" aria-label="这条与你有关吗">
                <button type="button" className={row.relevance === "need" ? "active" : ""} aria-pressed={row.relevance === "need"} onClick={() => chooseRelevance(currentIndex, "need")}>
                  <Check size={15} />要办
                </button>
                <button type="button" className={row.relevance === "later" ? "active" : ""} aria-pressed={row.relevance === "later"} onClick={() => chooseRelevance(currentIndex, "later")}>
                  <Clock3 size={15} />稍后
                </button>
                <button type="button" className={row.relevance === "not_mine" ? "active" : ""} aria-pressed={row.relevance === "not_mine"} onClick={() => chooseRelevance(currentIndex, "not_mine")}>
                  <X size={15} />与我无关
                </button>
              </div>
              {row.task.category === "fyi" && row.relevance !== "need" && <p className="review-decision-hint">仅阅知默认不加入待办；只有点「要办」才会生成待办。</p>}
              {row.relevance === "later" && row.task.category !== "fyi" && <p className="review-decision-hint">会以「待确认」保存，不会假定你一定要办理。</p>}
              {row.relevance === "not_mine" && <p className="review-decision-hint">不会加入待办；通知本身仍会保存。</p>}

              {row.relevance !== "not_mine" && (
                <>
                  <div className="review-chips">
                    <button type="button" className={`review-chip ${!row.deadline ? "pending" : ""} ${editingField === "deadline" ? "active" : ""}`} onClick={() => toggleEditor("deadline")}>
                      <CalendarDays size={13} /><span>{deadlineChipLabel}</span>
                    </button>
                    <button type="button" className={`review-chip ${!row.location ? "empty" : ""} ${editingField === "location" ? "active" : ""}`} onClick={() => toggleEditor("location")}>
                      <MapPin size={13} /><span>{row.location ? `地点：${row.location}` : "加地点"}</span>
                    </button>
                    <button type="button" className={`review-chip ${!row.materialsText ? "empty" : ""} ${editingField === "materials" ? "active" : ""}`} onClick={() => toggleEditor("materials")}>
                      <FileText size={13} /><span>{row.materialsText ? `材料：${row.materialsText}` : "加材料"}</span>
                    </button>
                    <button type="button" className={`review-chip ${!row.requirements ? "empty" : ""} ${editingField === "requirements" ? "active" : ""}`} onClick={() => toggleEditor("requirements")}>
                      <Info size={13} /><span>{row.requirements ? `要求：${row.requirements}` : "补充要求"}</span>
                    </button>
                    {task?.category !== "fyi" && (
                      <button type="button" className={`review-chip ${row.reminderLead === "none" ? "empty" : ""} ${editingField === "reminder" ? "active" : ""}`} onClick={() => toggleEditor("reminder")}>
                        <Bell size={13} /><span>{reminderChipLabel}</span>
                      </button>
                    )}
                  </div>

                  {editingField === "deadline" && (
                    <div className="review-chip-editor">
                      <label htmlFor={`review-deadline-${row.key}`}>日期与具体时刻</label>
                      <div className="review-inline-edit">
                        <input
                          id={`review-deadline-${row.key}`}
                          value={deadlineDraft}
                          placeholder="日期，例如 2026-11-26"
                          autoFocus
                          onChange={(event) => { setDeadlineDraft(event.target.value); setDeadlineError(""); }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              applyDeadline();
                            }
                          }}
                        />
                        <input
                          className="review-clock-input"
                          value={clockDraft}
                          placeholder="时刻，如 14:30"
                          aria-label="具体时刻，24 小时制，可留空"
                          onChange={(event) => { setClockDraft(event.target.value); setDeadlineError(""); }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              applyDeadline();
                            }
                          }}
                        />
                        <button type="button" className="secondary-button compact-button" onClick={applyDeadline}>确认</button>
                        <button type="button" className="text-button" onClick={clearDeadline}>清除</button>
                      </div>
                      <small>{rowSourceTime}。活动类事项会显示为「开始」，其余显示为「截止」。</small>
                      {deadlineError && <small className="review-chip-error" role="alert">{deadlineError}</small>}
                      <small>日期可写 2026-11-26、2026/11/26 或 2026年11月26日；时刻用 24 小时制 HH:mm。</small>
                    </div>
                  )}

                  {editingField === "location" && (
                    <div className="review-chip-editor">
                      <label htmlFor={`review-location-${row.key}`}>地点</label>
                      <input
                        id={`review-location-${row.key}`}
                        value={row.location}
                        maxLength={120}
                        placeholder="没有明确地点可留空"
                        autoFocus
                        onChange={(event) => patchRow(currentIndex, { location: event.target.value })}
                      />
                    </div>
                  )}

                  {editingField === "materials" && (
                    <div className="review-chip-editor">
                      <label htmlFor={`review-materials-${row.key}`}>材料（用逗号或顿号分隔）</label>
                      <input
                        id={`review-materials-${row.key}`}
                        value={row.materialsText}
                        maxLength={400}
                        placeholder="例如：学生证、报名表"
                        autoFocus
                        onChange={(event) => patchRow(currentIndex, { materialsText: event.target.value })}
                      />
                    </div>
                  )}

                  {editingField === "requirements" && (
                    <div className="review-chip-editor">
                      <label htmlFor={`review-requirements-${row.key}`}>补充要求 / 备注</label>
                      <textarea
                        id={`review-requirements-${row.key}`}
                        rows={2}
                        value={row.requirements}
                        maxLength={500}
                        placeholder="可以补充通知里的限制、对象或你记得的细节"
                        autoFocus
                        onChange={(event) => patchRow(currentIndex, { requirements: event.target.value })}
                      />
                    </div>
                  )}

                  {editingField === "reminder" && (
                    <div className="review-chip-editor">
                      <label htmlFor={`review-reminder-${row.key}`}><Bell size={13} />提醒</label>
                      <div className="review-reminder-controls">
                        <select
                          id={`review-reminder-${row.key}`}
                          value={row.reminderLead}
                          onChange={(event) => patchRow(currentIndex, { reminderLead: event.target.value as RowState["reminderLead"] })}
                        >
                          <option value="none">不提醒</option>
                          <option value="1d">提前一天</option>
                          <option value="2h">提前两小时</option>
                          <option value="custom">自定义时间</option>
                        </select>
                        {row.reminderLead === "custom" && (
                          <div className="review-cn-datetime">
                            <input
                              type="date"
                              value={row.customReminderAt.slice(0, 10)}
                              onChange={(event) => {
                                const next = normalizeChineseDateTime(event.target.value, row.customReminderAt.slice(11, 13), row.customReminderAt.slice(14, 16));
                                if (next) patchRow(currentIndex, { customReminderAt: next });
                              }}
                              aria-label="自定义提醒日期"
                            />
                            <select
                              value={row.customReminderAt.slice(11, 13)}
                              aria-label="自定义提醒小时"
                              onChange={(event) => {
                                const next = normalizeChineseDateTime(row.customReminderAt.slice(0, 10), event.target.value, row.customReminderAt.slice(14, 16));
                                if (next) patchRow(currentIndex, { customReminderAt: next });
                              }}
                            >
                              {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                            </select>
                            <span>时</span>
                            <select
                              value={row.customReminderAt.slice(14, 16)}
                              aria-label="自定义提醒分钟"
                              onChange={(event) => {
                                const next = normalizeChineseDateTime(row.customReminderAt.slice(0, 10), row.customReminderAt.slice(11, 13), event.target.value);
                                if (next) patchRow(currentIndex, { customReminderAt: next });
                              }}
                            >
                              {Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0")).map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                            </select>
                            <span>分</span>
                            <small>{formatDateTime(row.customReminderAt)}</small>
                          </div>
                        )}
                      </div>
                      <div className="review-reminder-actions">
                        <button type="button" className="text-button" onClick={() => patchRow(currentIndex, { reminderLead: "custom", customReminderAt: minuteFromNow() })}>
                          <Clock3 size={12} />设为 1 分钟后（测试系统通知）
                        </button>
                        <NotificationStatus
                          permission={permission}
                          hint="系统通知只在本页标签页打开时生效；关闭网页后无法继续提醒。"
                          onRequest={onRequestPermission}
                          onTest={onTestNotification}
                        />
                      </div>
                      <small>
                        {row.reminderLead === "none"
                          ? "也可以保存后在任务详情里设置。"
                          : reminderAt
                            ? `${formatDateTime(reminderAt)} 提醒。标签页保持打开时有效，关闭网页后无法提醒。`
                            : "提醒时间不完整，请检查日期。"}
                        {row.reminderLead !== "none" && row.reminderLead !== "custom" && ` ${reminderExplainer(task ?? row.task)}`}
                      </small>
                    </div>
                  )}

                  {row.relevance === "need" && task?.category === "needs_confirm" && (
                    <div className="review-confirm-line">
                      <label>
                        <input
                          type="checkbox"
                          checked={row.confirmActionable}
                          onChange={(event) => patchRow(currentIndex, { confirmActionable: event.target.checked })}
                        />
                        <span>我已核对原文，确认这是要办的事</span>
                      </label>
                      {(!row.deadline || row.imageUncertain) && (
                        <small>
                          {!row.deadline ? "补上具体日期后可转为「需办理」。" : ""}
                          {row.imageUncertain ? "截图内容不确定，仍会先标为待确认。" : ""}
                        </small>
                      )}
                    </div>
                  )}

                  {row.relations.length > 0 && relation && (
                    <div className="review-relation" data-tour="review-relation">
                      <div className="review-relation-head">
                        <AlertCircle size={14} />
                        <strong>这可能是已有任务「{relation.task.title}」</strong>
                      </div>
                      <p>
                        {relation.changed.length > 0 ? `变化：${relation.changed.join("、")}。` : "内容基本一致。"}
                        要更新已有任务，还是仍新建一条？
                      </p>
                      <div className="review-relation-choice">
                        {([
                          ["create_new", "仍新建"],
                          ["merge", "合并"],
                          ["update", "更新"],
                          ["skip", "跳过"],
                        ] as const).map(([value, label]) => (
                          <button
                            type="button"
                            key={value}
                            className={row.relationChoice === value ? "active" : ""}
                            aria-pressed={row.relationChoice === value}
                            onClick={() => {
                              patchRow(currentIndex, { relationChoice: value });
                              onTourEvent?.("relation-choice");
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {(row.relationChoice === "merge" || row.relationChoice === "update") && row.relations.length > 1 && (
                        <select
                          value={row.relationTaskId}
                          aria-label="选择已有任务"
                          onChange={(event) => patchRow(currentIndex, { relationTaskId: event.target.value })}
                        >
                          {row.relations.map((item) => (
                            <option key={item.task.id} value={item.task.id}>{item.task.title}（相似度 {Math.round(item.score * 100)}%）</option>
                          ))}
                        </select>
                      )}
                      <small>
                        {row.relationChoice === "merge"
                          ? "合并会补齐材料和要求，保留已有日期与地点。"
                          : row.relationChoice === "update"
                            ? "更新会用这次确认的内容覆盖标题、日期和分类。"
                            : row.relationChoice === "skip"
                              ? "这条不会加入，已有任务也不会改动。"
                              : "已有任务不会被改动。"}
                      </small>
                    </div>
                  )}
                </>
              )}

              <div className="review-evidence">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setOpenEvidence((current) => ({ ...current, [row.key]: !current[row.key] }))}
                >
                  <Quote size={13} />{evidenceOpen ? "收起原文与截图" : "看看原文与截图"}
                </button>
                {evidenceOpen && (
                  <div className="review-evidence-body">
                    <blockquote><mark>{row.task.sourceQuote}</mark></blockquote>
                    {row.task.uncertainty && <p className="review-uncertainty"><AlertCircle size={13} />{row.task.uncertainty}</p>}
                    {image && (
                      <div className="review-evidence-image">
                        <img src={imageDataUrl(image)} alt={image.name ?? "通知截图"} />
                        <p>{image.name ?? "截图"} · 这是模型的读图转写，请对照原图核对。</p>
                      </div>
                    )}
                    {image?.transcript && <pre>{image.transcript}</pre>}
                    <details>
                      <summary>查看这次粘贴的全部文字</summary>
                      <pre>{bodyPreview || "（这次没有粘贴文字，只使用了截图。）"}</pre>
                    </details>
                  </div>
                )}
              </div>
            </article>
          </div>
        )}

        <footer className="review-footer">
          <p className="review-save-note">保存后只写入当前浏览器；提醒需要网页保持打开。</p>
          <div className="review-footer-actions">
            <button type="button" className="secondary-button" onClick={onClose}>返回修改</button>
            <button type="button" className="primary-button" onClick={confirm} data-tour="review-save">
              <Check size={16} />
              {addable > 0 ? "保存并加入待办" : "只保存这条通知"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}