import { CalendarDays, Check, FileText, Quote, X } from "lucide-react";
import type { Task } from "../types";

interface Props {
  task: Task | null;
  noticeTitle?: string;
  onClose: () => void;
  onToggleDone: () => void;
  onDeadlineChange: (deadline: string | null) => void;
  onLocate: () => void;
}

export function TaskDetailDialog({ task, noticeTitle, onClose, onToggleDone, onDeadlineChange, onLocate }: Props) {
  if (!task) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="关闭任务详情"><X size={19} /></button>
        <p className="eyebrow">任务详情</p>
        <h2 id="task-detail-title">{task.title}</h2>
        <p className="detail-action">{task.action}</p>
        <dl className="detail-grid">
          <div><dt>状态</dt><dd>{task.status === "done" ? "已完成" : task.category === "fyi" ? "仅阅知" : "待完成"}</dd></div>
          <div><dt>分类</dt><dd>{task.category === "needs_confirm" ? "待确认" : task.category === "fyi" ? "仅阅知" : "需行动"}</dd></div>
          <div className="detail-wide"><dt><CalendarDays size={14} />确认日期</dt><dd><input type="date" value={task.deadline ?? ""} onChange={(event) => onDeadlineChange(event.target.value || null)} /><span>{task.deadline ? "日期由你确认，可再次修改" : "原文日期不明确，请核实后填写"}</span></dd></div>
          <div className="detail-wide"><dt>原文时间表述</dt><dd>{task.deadlineText ?? "原文未提供"}</dd></div>
        </dl>
        {task.materials.length > 0 && <div className="detail-materials"><h3><FileText size={15} />需准备材料</h3><ul>{task.materials.map((material) => <li key={material}>{material}</li>)}</ul></div>}
        <div className="detail-quote"><h3><Quote size={15} />原文证据</h3><blockquote>{task.sourceQuote}</blockquote><span>{noticeTitle}</span></div>
        <div className="modal-actions split-actions">
          <button type="button" className="secondary-button" onClick={onLocate}>回到通知原句</button>
          <button type="button" className="primary-button" onClick={onToggleDone}><Check size={16} />{task.status === "done" ? "取消完成" : "标为已完成"}</button>
        </div>
      </section>
    </div>
  );
}
