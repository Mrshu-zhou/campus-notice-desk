import { BellRing, CheckCircle2, Clock3 } from "lucide-react";
import { NotificationStatus } from "./NotificationStatus";
import { postponeChoices, reminderBadgeLabel, summarizePriority } from "../lib/reminders";
import { formatDeadlineLabel, isOverdue } from "../lib/tasks";
import type { NotificationState } from "../lib/notifications";
import type { ReminderState, Task } from "../types";

interface Props {
  tasks: Task[];
  reminders: Record<string, ReminderState>;
  today: string;
  permission: NotificationState;
  testing?: boolean;
  onLocate: (task: Task) => void;
  onNow: (task: Task) => void;
  onPostpone: (task: Task, until: string) => void;
  onRequestPermission: () => void;
  onTestNotification: () => void;
}

export function ReminderInbox({
  tasks,
  reminders,
  today,
  permission,
  testing = false,
  onLocate,
  onNow,
  onPostpone,
  onRequestPermission,
  onTestNotification,
}: Props) {
  const due = summarizePriority(tasks, reminders).reminded;
  const choices = postponeChoices();
  return (
    <div className="reminder-inbox" role="status">
      <div className="reminder-inbox-head">
        <div>
          <BellRing size={15} />
          <strong>提醒到点，待你处理</strong>
          <span>{due.length > 0 ? `${due.length} 件` : "暂无到点提醒"}</span>
        </div>
        <NotificationStatus
          permission={permission}
          testing={testing}
          onRequest={onRequestPermission}
          onTest={onTestNotification}
        />
      </div>
      {due.length > 0 && (
        <div className="reminder-inbox-list">
          {due.map((task) => (
            <article className="reminder-item" key={task.id}>
              <button type="button" className="reminder-item-main" onClick={() => onLocate(task)}>
                <strong>{task.title}</strong>
                <span>
                  {isOverdue(task, today) ? "已过期 · " : ""}
                  {task.deadline ? formatDeadlineLabel(task.deadline, task.deadlineText, task.deadlineClock, `${task.title} ${task.action}`) : "未设日期"}
                  {reminders[task.id] && ` · ${reminderBadgeLabel(reminders[task.id], task)}`}
                </span>
              </button>
              <div className="reminder-actions">
                <button type="button" className="primary-button compact-button" onClick={() => onNow(task)}><CheckCircle2 size={13} />现在处理</button>
                {choices.map((choice) => (
                  <button type="button" className="secondary-button compact-button" key={choice.id} onClick={() => onPostpone(task, choice.until)}>
                    <Clock3 size={12} />{choice.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}