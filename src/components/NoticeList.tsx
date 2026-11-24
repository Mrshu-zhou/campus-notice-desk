import { Inbox, Trash2 } from "lucide-react";
import { sourceLabels } from "../data";
import { formatReceivedAt } from "../lib/tasks";
import type { Notice, Task } from "../types";

interface Props {
  notices: Notice[];
  tasks: Task[];
  currentId: string;
  onSelect: (id: string) => void;
  onDelete: (notice: Notice) => void;
}

export function NoticeList({ notices, tasks, currentId, onSelect, onDelete }: Props) {
  return (
    <section className="panel notice-panel" aria-label="通知列表">
      <div className="panel-heading">
        <div><Inbox size={16} /><h2>通知收件箱</h2></div>
        <span>{notices.length} 条</span>
      </div>
      <div className="notice-list">
        {notices.map((notice) => {
          const noticeTasks = tasks.filter((task) => task.noticeId === notice.id);
          const pending = noticeTasks.filter((task) => task.status === "todo" && task.category !== "fyi").length;
          const footLabel = noticeTasks.length === 0
            ? "暂无待办"
            : noticeTasks.some((task) => task.category === "fyi") && pending === 0
              ? "仅阅知"
              : pending > 0 ? `${pending} 件待办` : "已完成";
          return (
            <div className={`notice-item ${notice.id === currentId ? "selected" : ""}`} key={notice.id}>
              <button
                type="button"
                className="notice-select"
                onClick={() => onSelect(notice.id)}
                aria-current={notice.id === currentId ? "true" : undefined}
              >
                <span className="notice-meta">
                  <span className={`unread-dot ${notice.read ? "read" : ""}`} aria-label={notice.read ? "已读" : "未读"} />
                  <span className="tag">{sourceLabels[notice.sourceType]}</span>
                  <span className="source-name">{notice.sourceLabel}</span>
                </span>
                <strong>{notice.title}</strong>
                <span className="notice-foot">
                  {formatReceivedAt(notice.receivedAt)}
                  <span>{footLabel}</span>
                </span>
              </button>
              <button
                type="button"
                className="notice-delete"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(notice);
                }}
                aria-label={`删除通知：${notice.title}`}
                title="删除这条通知"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
