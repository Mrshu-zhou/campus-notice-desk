import { AlarmClock, CalendarClock, CheckCircle2, ChevronRight, Clock3, ListChecks } from "lucide-react";
import { ReminderInbox } from "./ReminderInbox";
import { summarizePriority } from "../lib/reminders";
import { countIncompleteTasks } from "../lib/task-counts";
import { formatShortDate, isOverdue } from "../lib/tasks";
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
  onViewAll: () => void;
}

export function TodayFocus({
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
  onViewAll,
}: Props) {
  const priority = summarizePriority(tasks, reminders);
  const dueReminders = priority.reminded;
  const dueSoon = priority.dueSoon.filter((task) => !isOverdue(task, today));
  const pending = countIncompleteTasks(tasks);
  const priorityIds = new Set([
    ...dueReminders.map((task) => task.id),
    ...priority.overdue.map((task) => task.id),
    ...dueSoon.map((task) => task.id),
  ]);
  const others = tasks
    .filter((task) => task.status === "todo" && task.category !== "fyi" && !priorityIds.has(task.id))
    .sort((left, right) => {
      if (left.category === "needs_confirm" && right.category !== "needs_confirm") return -1;
      if (right.category === "needs_confirm" && left.category !== "needs_confirm") return 1;
      if (left.deadline && right.deadline) return left.deadline.localeCompare(right.deadline);
      if (left.deadline) return -1;
      if (right.deadline) return 1;
      return left.title.localeCompare(right.title, "zh-CN");
    });
  const hasAnything = dueReminders.length > 0 || priority.overdue.length > 0 || dueSoon.length > 0 || others.length > 0;

  return (
    <section className="today-focus" aria-label="优先处理" data-tour="today-focus">
      <ReminderInbox
        tasks={tasks}
        reminders={reminders}
        today={today}
        permission={permission}
        testing={testing}
        onLocate={onLocate}
        onNow={onNow}
        onPostpone={onPostpone}
        onRequestPermission={onRequestPermission}
        onTestNotification={onTestNotification}
      />

      <div className="priority-panel">
        <header className="priority-head">
          <div>
            <AlarmClock size={16} />
            <strong>先处理这些</strong>
            <span>{pending} 件未完成 · {dueReminders.length} 件已提醒 · {others.length} 件其他</span>
          </div>
          <button type="button" className="text-button priority-view-all" onClick={onViewAll}>
            查看全部未完成<ChevronRight size={13} />
          </button>
        </header>
        {!hasAnything ? (
          <div className="priority-empty">
            <CheckCircle2 size={18} />
            <p>未来 3 天没有临近日期，也没有到点未处理的提醒。新通知整理后会汇总到这里。</p>
          </div>
        ) : (
          <div className="priority-columns">
            <div className="priority-column" data-empty={dueReminders.length === 0}>
              <span className="priority-label red"><CalendarClock size={12} />已提醒未处理</span>
              {dueReminders.length === 0 ? <small className="priority-none">没有到点提醒</small> : dueReminders.slice(0, 4).map((task) => (
                <button type="button" className="priority-item" onClick={() => onLocate(task)} key={task.id}>
                  <span>{task.title}</span>
                  <small>{task.deadline ? formatShortDate(task.deadline) : "未设日期"}<ChevronRight size={12} /></small>
                </button>
              ))}
            </div>
            <div className="priority-column" data-empty={priority.overdue.length === 0}>
              <span className="priority-label red"><CalendarClock size={12} />已过期</span>
              {priority.overdue.length === 0 ? <small className="priority-none">没有过期任务</small> : priority.overdue.slice(0, 4).map((task) => (
                <button type="button" className="priority-item" onClick={() => onLocate(task)} key={task.id}>
                  <span>{task.title}</span>
                  <small>{formatShortDate(task.deadline)}<ChevronRight size={12} /></small>
                </button>
              ))}
            </div>
            <div className="priority-column" data-empty={dueSoon.length === 0}>
              <span className="priority-label amber"><Clock3 size={12} />3 天内到期</span>
              {dueSoon.length === 0 ? <small className="priority-none">没有临近日期</small> : dueSoon.slice(0, 4).map((task) => (
                <button type="button" className="priority-item" onClick={() => onLocate(task)} key={task.id}>
                  <span>{task.title}</span>
                  <small>{formatShortDate(task.deadline)}<ChevronRight size={12} /></small>
                </button>
              ))}
            </div>
            <div className="priority-column" data-empty={others.length === 0}>
              <span className="priority-label neutral"><ListChecks size={12} />其他未完成</span>
              {others.length === 0 ? <small className="priority-none">没有其他待办</small> : others.slice(0, 4).map((task) => (
                <button type="button" className="priority-item" onClick={() => onLocate(task)} key={task.id}>
                  <span>{task.title}</span>
                  <small>{task.deadline ? formatShortDate(task.deadline) : task.category === "needs_confirm" ? "日期待确认" : "未设日期"}<ChevronRight size={12} /></small>
                </button>
              ))}
              {others.length > 4 && (
                <button type="button" className="text-button priority-more" onClick={onViewAll}>还有 {others.length - 4} 件，查看全部</button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}