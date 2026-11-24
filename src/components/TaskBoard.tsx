import { useMemo, useState, type ReactNode } from "react";
import { CalendarDays, CalendarPlus, CheckCircle2, CircleAlert, ListTodo } from "lucide-react";
import { compareTasks, downloadCalendar, isOverdue } from "../lib/tasks";
import type { Notice, Task } from "../types";
import { TaskCard } from "./TaskCard";

type Filter = "todo" | "needs_confirm" | "done" | "fyi";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "todo", label: "待完成" },
  { id: "needs_confirm", label: "待确认" },
  { id: "done", label: "已完成" },
  { id: "fyi", label: "仅阅知" },
];

interface Props {
  tasks: Task[];
  notices: Notice[];
  today: string;
  reminderInbox?: ReactNode;
  onToggleDone: (task: Task) => void;
  onDetail: (task: Task) => void;
  onLocate: (task: Task) => void;
}

export function TaskBoard({ tasks, notices, today, reminderInbox, onToggleDone, onDetail, onLocate }: Props) {
  const [filter, setFilter] = useState<Filter>("todo");
  const todo = tasks.filter((task) => task.status === "todo" && task.category !== "fyi");
  const confirm = todo.filter((task) => task.category === "needs_confirm");
  const done = tasks.filter((task) => task.status === "done");
  const overdue = todo.filter((task) => isOverdue(task, today));
  const visible = useMemo(() => tasks.filter((task) => {
    if (filter === "todo") return task.status === "todo" && task.category !== "fyi";
    if (filter === "needs_confirm") return task.status === "todo" && task.category === "needs_confirm";
    if (filter === "done") return task.status === "done";
    return task.category === "fyi";
  }).sort(compareTasks), [tasks, filter]);

  return (
    <main className="board-page">
      <div className="board-title-row">
        <div><p className="eyebrow">从通知到行动</p><h1>任务看板</h1><p>按日期整理，所有任务都能回到通知原句。</p></div>
        <button className="secondary-button" type="button" onClick={() => downloadCalendar(visible.filter((task) => task.deadline))} disabled={!visible.some((task) => task.deadline)}>
          <CalendarPlus size={16} />导出当前日历
        </button>
      </div>
      {reminderInbox}
      <section className="board-stats" aria-label="任务统计">
        <div><ListTodo size={18} /><span>待完成</span><strong>{todo.length}</strong></div>
        <div className={overdue.length ? "stat-alert" : ""}><CalendarDays size={18} /><span>已过期</span><strong>{overdue.length}</strong></div>
        <div><CircleAlert size={18} /><span>待确认</span><strong>{confirm.length}</strong></div>
        <div><CheckCircle2 size={18} /><span>已完成</span><strong>{done.length}</strong></div>
      </section>
      <div className="board-filters" role="tablist" aria-label="任务筛选">
        {filters.map((item) => <button type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)} key={item.id}>{item.label}</button>)}
      </div>
      <section className="board-list">
        {visible.length === 0 ? <div className="empty-state"><CheckCircle2 size={28} /><h2>这里已经清空</h2><p>切换其他筛选查看任务。</p></div> : visible.map((task) => {
          const notice = notices.find((item) => item.id === task.noticeId);
          return (
            <div className="board-task" key={task.id}>
              <TaskCard task={task} today={today} sourceLabel={notice?.sourceLabel} sourceBody={notice?.body} screenshots={notice?.screenshots} onSelect={() => onDetail(task)} onToggleDone={() => onToggleDone(task)} />
              <button type="button" className="board-source" onClick={() => onLocate(task)}>{notice?.sourceLabel ?? "通知原文"}<span>打开通知</span></button>
            </div>
          );
        })}
      </section>
    </main>
  );
}
