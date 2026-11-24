import { useState } from "react";
import { AlertCircle, CalendarDays, Check, ExternalLink, FileText, Info, MapPin, Quote } from "lucide-react";
import { imageDataUrl } from "../lib/images";
import { deadlineSourceNote, extractLinks, formatDeadlineLabel, isOverdue } from "../lib/tasks";
import type { SourceImage, Task } from "../types";

interface Props {
  task: Task;
  today: string;
  sourceLabel?: string;
  sourceBody?: string;
  screenshots?: SourceImage[];
  selected?: boolean;
  compact?: boolean;
  onSelect?: () => void;
  onToggleDone: () => void;
}

export function TaskCard({ task, today, sourceLabel, sourceBody, screenshots, selected, compact, onSelect, onToggleDone }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);
  const overdue = isOverdue(task, today);
  const done = task.status === "done";
  const evidenceImage = task.sourceImageId ? screenshots?.find((image) => image.id === task.sourceImageId) : undefined;
  const links = extractLinks(task.action, task.requirements, task.sourceQuote, sourceBody);
  const timeNote = deadlineSourceNote(task.deadline, task.deadlineText);
  const originBadge = task.origin === "cloud_agent"
    ? "Cloud Agent 拆解"
    : task.origin === "local_fixture"
      ? "本地核对样例"
      : task.origin === "verified_offline"
        ? "离线已核对"
        : null;
  return (
    <article
      className={`task-card ${selected ? "selected" : ""} ${task.category === "needs_confirm" ? "needs-confirm" : ""} ${task.category === "fyi" ? "fyi" : ""} ${done ? "done" : ""}`}
      onClick={onSelect}
    >
      <div className="task-card-top">
        <button
          type="button"
          className={`task-check ${done ? "checked" : ""}`}
          aria-label={done ? `将${task.title}标为未完成` : `将${task.title}标为已完成`}
          aria-pressed={done}
          onClick={(event) => { event.stopPropagation(); onToggleDone(); }}
        >
          {done && <Check size={14} strokeWidth={3} />}
        </button>
        <div className="task-title-button">
          <h3>{task.title}</h3>
        </div>
      </div>
      <div className="task-badges">
        {task.category === "fyi" ? (
          <span className="badge neutral"><Info size={12} />仅阅知</span>
        ) : task.category === "needs_confirm" ? (
          <span className="badge amber"><AlertCircle size={12} />待确认</span>
        ) : (
          <span className={`badge ${overdue ? "red" : "green"}`}><CalendarDays size={12} />{overdue ? "已过期 · " : ""}{formatDeadlineLabel(task.deadline, task.deadlineText, task.deadlineClock, `${task.title} ${task.action}`)}</span>
        )}
        {originBadge && (
          <span className={`badge ${task.origin === "cloud_agent" ? "green" : "neutral"}`}>{originBadge}</span>
        )}
        {sourceLabel && <span className="badge neutral">来源：{sourceLabel}</span>}
      </div>
      {!compact && <p className="task-action">{task.action}</p>}
      {!compact && (
        <p className="task-time-note">
          <CalendarDays size={12} />
          <span>{formatDeadlineLabel(task.deadline, task.deadlineText, task.deadlineClock, `${task.title} ${task.action}`)} · {timeNote}</span>
        </p>
      )}
      {!compact && links.length > 0 && (
        <div className="task-links">
          {links.map((link) => (
            <a key={link} href={link} target="_blank" rel="noreferrer noopener" onClick={(event) => event.stopPropagation()}>
              <ExternalLink size={12} />{link}
            </a>
          ))}
        </div>
      )}
      {task.materials.length > 0 && !compact && (
        <p className="task-materials"><FileText size={13} /><span>{task.materials.join("、")}</span></p>
      )}
      {task.location && !compact && (
        <p className="task-materials"><MapPin size={13} /><span>{task.location}</span></p>
      )}
      {task.requirements && !compact && (
        <p className="task-materials"><Info size={13} /><span>{task.requirements}</span></p>
      )}
      {!compact && (task.sourceQuote || evidenceImage) && (
        <div className="evidence-block">
          <button
            type="button"
            className="text-button evidence-toggle"
            onClick={(event) => { event.stopPropagation(); setShowEvidence((open) => !open); }}
          >
            <Quote size={13} />{showEvidence ? "收起依据" : "查看依据"}
          </button>
          {showEvidence && (
            <div className="evidence-detail">
              {task.sourceQuote && (
                <blockquote className="evidence-quote">
                  <mark>{task.sourceQuote}</mark>
                </blockquote>
              )}
              {evidenceImage && (
                <figure className="task-evidence-image">
                  {evidenceImage.data && <img src={imageDataUrl(evidenceImage)} alt={evidenceImage.name ?? "通知截图"} />}
                  <figcaption>{evidenceImage.name ?? "通知截图"}{evidenceImage.transcript ? " · 模型读图转写如下" : ""}</figcaption>
                  {evidenceImage.transcript && <pre>{evidenceImage.transcript}</pre>}
                </figure>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
