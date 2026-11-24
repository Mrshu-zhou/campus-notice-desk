import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, ClipboardPaste, FileText, GraduationCap, Inbox, LayoutDashboard, ListTodo, Mail, MailOpen, MessageSquareText, Quote, Trash2 } from "lucide-react";
import { NoticeArticle } from "./components/NoticeArticle";
import { NoticeList } from "./components/NoticeList";
import { PipelinePanel } from "./components/PipelinePanel";
import { TaskCard } from "./components/TaskCard";
import { TaskBoard } from "./components/TaskBoard";
import { PasteDialog } from "./components/PasteDialog";
import { IntakeDesk } from "./components/IntakeDesk";
import { JudgeDialog, TourCoach } from "./components/JudgeDialog";
import { ReminderInbox } from "./components/ReminderInbox";
import { ReviewDialog } from "./components/ReviewDialog";
import { TodayFocus } from "./components/TodayFocus";
import { CLASS_NOTICE_ID, CLASS_PRELUDE_COUNT, COUNSELOR_NOTICE_ID, seedNotices, seedTasks, sourceLabels } from "./data";
import { extractTasks } from "./lib/extraction";
import { verifyLabResult } from "./lib/agent-lab";
import { gateExtractedTasks, repairExtractedTask } from "./lib/gates";
import {
  appendPipelineLog,
  createPipelineRun,
  patchPipelineStage,
  pipelineModeLabel,
  type DemoPhase,
  type PipelineRun,
  type PipelineStageId,
} from "./lib/pipeline";
import { visibleWorkbenchNotices, visibleWorkbenchTasks } from "./lib/workbench-visibility";
import { loadState, persistRoleStates } from "./lib/storage";
import { pruneRoleState, removeNoticeFromState } from "./lib/state-hygiene";
import { applyRoleState, compareTasks, formatDeadlineLabel, formatReceivedAt, localDateString } from "./lib/tasks";
import { describeReviewOutcome, imageReadsFromNotice, type ApplyReviewOutput } from "./lib/review";
import type { IntakeSession } from "./lib/intake";
import { acknowledgeReminder, formatDateTime, postponeReminder, shouldNotify, toLocalDateTime } from "./lib/reminders";
import { notificationFailureReason, toNotificationState, type NotificationState } from "./lib/notifications";
import { applyTourEvent, TOUR_STEPS, type TourEvent } from "./lib/judge";
import { MOBILE_SECTIONS, sectionAfterSave, type MobileSection } from "./lib/mobile-nav";
import type { ExtractionResult, Notice, ReminderState, Role, RoleState, Task } from "./types";

type ReminderNotificationOptions = NotificationOptions & {
  renotify?: boolean;
  actions?: Array<{ action: string; title: string }>;
};

function computeRoleTasks(targetRole: Role, state: RoleState) {
  const hasCustomClassTasks = state.customTasks.some((task) => task.noticeId === CLASS_NOTICE_ID);
  const all = applyRoleState([
    ...seedTasks.filter((task) => task.role === targetRole && (task.noticeId !== CLASS_NOTICE_ID || (state.demoComplete && !hasCustomClassTasks))),
    ...state.customTasks,
  ], state);
  return all.filter((task) => task.noticeId !== CLASS_NOTICE_ID || state.demoComplete);
}

function actionableRoleTasks(targetRole: Role, state: RoleState) {
  const customNoticeIds = new Set(state.customNotices.filter((notice) => notice.role === targetRole).map((notice) => notice.id));
  return computeRoleTasks(targetRole, state).filter((task) => targetRole !== "student"
    || task.noticeId === CLASS_NOTICE_ID
    || customNoticeIds.has(task.noticeId));
}

function initialRoleStates(): Record<Role, RoleState> {
  const load = (targetRole: Role) => pruneRoleState(loadState(targetRole), {
    role: targetRole,
    seedNoticeIds: seedNotices.filter((notice) => notice.role === targetRole).map((notice) => notice.id),
    seedTaskIds: seedTasks.filter((task) => task.role === targetRole).map((task) => task.id),
  });
  return { student: load("student"), counselor: load("counselor") };
}

function notificationState(): NotificationState {
  return typeof Notification === "undefined" ? "unsupported" : toNotificationState(Notification.permission);
}

const NOTICE_SOURCE_ICONS = {
  wechat_group: MessageSquareText,
  dingtalk_or_wecom: MessageSquareText,
  email: Mail,
  paste: ClipboardPaste,
} as const;

export default function App() {
  const [role, setRole] = useState<Role>("student");
  const [states, setStates] = useState<Record<Role, RoleState>>(initialRoleStates);
  const [view, setView] = useState<"workbench" | "board">("workbench");
  const [mobileSection, setMobileSection] = useState<MobileSection>("intake");
  const [currentId, setCurrentId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [reviewSession, setReviewSession] = useState<IntakeSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Notice | null>(null);
  const [judgeOpen, setJudgeOpen] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [intakeDemoSignal, setIntakeDemoSignal] = useState(0);
  const [intakeFocusSignal, setIntakeFocusSignal] = useState(0);
  const [intakeResetSignal, setIntakeResetSignal] = useState(0);
  const [notificationPermission, setNotificationPermission] = useState<NotificationState>(() => notificationState());
  const [notificationTesting, setNotificationTesting] = useState(false);
  const [demoPhase, setDemoPhase] = useState<DemoPhase>("idle");
  const [demoBusy, setDemoBusy] = useState(false);
  const [runs, setRuns] = useState<Record<string, PipelineRun>>({});
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [toast, setToast] = useState("");
  const [sessionNoticeIds, setSessionNoticeIds] = useState<string[]>([]);
  const today = localDateString();
  const roleState = states[role];
  const statesRef = useRef(states);
  const permissionRef = useRef(notificationPermission);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  statesRef.current = states;
  permissionRef.current = notificationPermission;
  const classNotice = useMemo(() => seedNotices.find((notice) => notice.id === CLASS_NOTICE_ID), []);
  const idleDemoRun = useMemo(() => classNotice
    ? createPipelineRun({
        noticeId: classNotice.id,
        source: "demo",
        role: "student",
        sourceType: classNotice.sourceType,
        roleLabel: "学生",
        sourceLabel: sourceLabels[classNotice.sourceType],
        bodyLength: classNotice.body.length,
        today,
      })
    : null, [classNotice, today]);

  function applyReminderAction(targetRole: Role, task: Task, action: "now" | "snooze") {
    if (action === "snooze") {
      const until = toLocalDateTime(new Date(Date.now() + 15 * 60 * 1000));
      setStates((previous) => {
        const reminder = previous[targetRole].reminders[task.id];
        if (!reminder) return previous;
        return {
          ...previous,
          [targetRole]: {
            ...previous[targetRole],
            reminders: { ...previous[targetRole].reminders, [task.id]: postponeReminder(reminder, until) },
          },
        };
      });
      setToast(`已推迟到 ${formatDateTime(until)}；在此之前不会重复提醒。`);
      return;
    }
    setStates((previous) => {
      const reminder = previous[targetRole].reminders[task.id];
      if (!reminder) return previous;
      return {
        ...previous,
        [targetRole]: {
          ...previous[targetRole],
          reminders: { ...previous[targetRole].reminders, [task.id]: acknowledgeReminder(reminder) },
        },
      };
    });
    setRole(targetRole);
    setView("workbench");
    setMobileSection("tasks");
    setCurrentId(task.noticeId);
    setSelectedTaskId(task.id);
    if (targetRole === "student" && task.noticeId === CLASS_NOTICE_ID) setDemoPhase("complete");
    setToast("已打开这条待办；处理完后请勾选完成。");
  }

  function showSystemNotification(task: Task, targetRole: Role) {
    const title = `待办提醒：${task.title}`;
    const body = `${task.action}${task.deadline ? ` · ${formatDeadlineLabel(task.deadline, task.deadlineText, task.deadlineClock, `${task.title} ${task.action}`)}` : ""}`;
    const tag = `notice-desk-${task.id}`;
    const fallback = () => {
      try {
        const notification = new Notification(title, {
          body: `${body}。打开任务台可选择现在处理或稍后再叫。`,
          tag,
          requireInteraction: true,
          silent: false,
        });
        notification.onclick = () => {
          window.focus();
          applyReminderAction(targetRole, task, "now");
          notification.close();
        };
      } catch {
        // The in-page inbox still shows this reminder.
      }
    };
    const registration = swRegistrationRef.current;
    if (!registration) {
      fallback();
      return;
    }
    const options: ReminderNotificationOptions = {
      body,
      tag,
      requireInteraction: true,
      renotify: true,
      silent: false,
      data: { taskId: task.id, role: targetRole },
      actions: [
        { action: "now", title: "现在处理" },
        { action: "snooze", title: "稍后再叫我" },
      ],
    };
    void registration.showNotification(title, options).catch(fallback);
  }

  useEffect(() => {
    persistRoleStates(states);
  }, [states]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let disposed = false;
    void navigator.serviceWorker.register("/notify-sw.js", { scope: "/" })
      .then((registration) => {
        if (!disposed) swRegistrationRef.current = registration;
      })
      .catch(() => {});
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; action?: string; taskId?: string; role?: string } | null;
      if (!data || data.type !== "notice-desk-reminder-action" || typeof data.taskId !== "string") return;
      const targetRole: Role = data.role === "counselor" ? "counselor" : "student";
      const task = actionableRoleTasks(targetRole, statesRef.current[targetRole]).find((item) => item.id === data.taskId);
      if (!task) return;
      applyReminderAction(targetRole, task, data.action === "snooze" ? "snooze" : "now");
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  useEffect(() => {
    const syncPermission = () => setNotificationPermission(notificationState());
    document.addEventListener("visibilitychange", syncPermission);
    return () => document.removeEventListener("visibilitychange", syncPermission);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("reminder");
    if (!taskId) return;
    const targetRole: Role = params.get("role") === "counselor" ? "counselor" : "student";
    const action = params.get("action") === "snooze" ? "snooze" : "now";
    const task = actionableRoleTasks(targetRole, statesRef.current[targetRole]).find((item) => item.id === taskId);
    window.history.replaceState({}, "", window.location.pathname);
    if (task) applyReminderAction(targetRole, task, action);
  }, []);

  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      const due: Array<{ role: Role; task: Task; reminder: ReminderState }> = [];
      (["student", "counselor"] as Role[]).forEach((targetRole) => {
        const targetState = statesRef.current[targetRole];
        actionableRoleTasks(targetRole, targetState).forEach((task) => {
          const reminder = targetState.reminders[task.id];
          if (reminder && shouldNotify(reminder, task, now)) due.push({ role: targetRole, task, reminder });
        });
      });
      if (due.length === 0) return;
      if (permissionRef.current === "granted" && typeof Notification !== "undefined") {
        due.forEach(({ role: targetRole, task }) => showSystemNotification(task, targetRole));
      }
      setStates((previous) => {
        const next = { ...previous };
        due.forEach(({ role: targetRole, task, reminder }) => {
          next[targetRole] = {
            ...next[targetRole],
            reminders: {
              ...next[targetRole].reminders,
              [task.id]: { ...reminder, notifiedAt: now.toISOString() },
            },
          };
        });
        return next;
      });
    };
    checkReminders();
    const timer = window.setInterval(checkReminders, 30_000);
    const checkSoon = () => {
      if (document.visibilityState === "visible") checkReminders();
    };
    document.addEventListener("visibilitychange", checkSoon);
    window.addEventListener("focus", checkSoon);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", checkSoon);
      window.removeEventListener("focus", checkSoon);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const sourceNotices = useMemo(() => {
    const hidden = new Set(roleState.hiddenNoticeIds ?? []);
    const base = [...seedNotices.filter((notice) => notice.role === role), ...roleState.customNotices]
      .filter((notice) => !hidden.has(notice.id));
    return base.map((notice) => {
      const read = Object.prototype.hasOwnProperty.call(roleState.read, notice.id) ? roleState.read[notice.id] : notice.read;
      if (notice.id === CLASS_NOTICE_ID && notice.thread) {
        let count = notice.thread.length;
        if (demoPhase === "idle") count = CLASS_PRELUDE_COUNT;
        else if (demoPhase === "ingest" || demoPhase === "classify" || demoPhase === "extract" || demoPhase === "failed") count = CLASS_PRELUDE_COUNT + 1;
        return { ...notice, read, thread: notice.thread.slice(0, count) };
      }
      return { ...notice, read };
    });
  }, [role, roleState, demoPhase]);

  const tasks = useMemo(() => {
    const hidden = new Set(roleState.hiddenNoticeIds ?? []);
    const all = computeRoleTasks(role, roleState).filter((task) => !hidden.has(task.noticeId));
    const notices = [...seedNotices.filter((notice) => notice.role === role), ...roleState.customNotices];
    return all.map((task) => {
      const notice = notices.find((item) => item.id === task.noticeId);
      return notice?.body || notice?.screenshots?.length
        ? repairExtractedTask(task, notice.body, imageReadsFromNotice(notice))
        : task;
    });
  }, [role, roleState]);

  const reviewExistingTasks = useMemo(() => {
    if (!reviewSession) return [];
    const targetRole = reviewSession.role;
    const targetState = states[targetRole];
    const hidden = new Set(targetState.hiddenNoticeIds ?? []);
    const notices = [...seedNotices.filter((notice) => notice.role === targetRole), ...targetState.customNotices];
    return actionableRoleTasks(targetRole, targetState)
      .filter((task) => !hidden.has(task.noticeId))
      .map((task) => {
      const notice = notices.find((item) => item.id === task.noticeId);
      return notice?.body || notice?.screenshots?.length
        ? repairExtractedTask(task, notice.body, imageReadsFromNotice(notice))
        : task;
    });
  }, [reviewSession, states]);

  const availableSessionNoticeIds = useMemo(
    () => [...sessionNoticeIds, ...roleState.customNotices.map((notice) => notice.id)],
    [sessionNoticeIds, roleState.customNotices],
  );
  const inboxNotices = visibleWorkbenchNotices(sourceNotices, role, demoPhase !== "idle", availableSessionNoticeIds);
  const visibleTasks = visibleWorkbenchTasks(tasks, inboxNotices);
  const currentNotice = inboxNotices.find((notice) => notice.id === currentId) ?? inboxNotices[0];
  const currentTasks = visibleTasks.filter((task) => task.noticeId === currentNotice?.id).sort(compareTasks);
  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId);
  const sourceNotice = role === "student"
    ? sourceNotices.find((notice) => notice.id === CLASS_NOTICE_ID)
    : sourceNotices.find((notice) => notice.id === COUNSELOR_NOTICE_ID) ?? sourceNotices[0];
  const currentRun = currentNotice
    ? runs[currentNotice.id] ?? (role === "student" && currentNotice.id === CLASS_NOTICE_ID ? idleDemoRun : null)
    : null;

  useEffect(() => {
    if (currentNotice && selectedTask?.noticeId === currentNotice.id) return;
    setSelectedTaskId(currentTasks[0]?.id ?? null);
  }, [currentNotice?.id]);

  useEffect(() => {
    if (!inboxNotices.some((notice) => notice.id === currentId)) {
      setCurrentId(inboxNotices[0]?.id ?? "");
    }
  }, [inboxNotices, currentId]);

  function updateRoleState(targetRole: Role, update: (state: RoleState) => RoleState) {
    setStates((previous) => ({ ...previous, [targetRole]: update(previous[targetRole]) }));
  }

  function selectNotice(id: string, taskId?: string) {
    setCurrentId(id);
    setSelectedTaskId(taskId ?? null);
  }

  function confirmDeleteNotice() {
    if (!deleteTarget) return;
    const notice = deleteTarget;
    const isSeed = seedNotices.some((item) => item.id === notice.id && item.role === notice.role);
    const extraTaskIds = isSeed
      ? seedTasks.filter((task) => task.role === notice.role && task.noticeId === notice.id).map((task) => task.id)
      : [];
    updateRoleState(notice.role, (state) => removeNoticeFromState(state, notice.id, {
      hideSeedNotice: isSeed,
      extraTaskIds,
    }));
    setSessionNoticeIds((ids) => ids.filter((id) => id !== notice.id));
    setRuns((previous) => {
      if (!(notice.id in previous)) return previous;
      const next = { ...previous };
      delete next[notice.id];
      return next;
    });
    if (currentId === notice.id) {
      setCurrentId("");
      setSelectedTaskId(null);
    }
    if (role === "student" && notice.id === CLASS_NOTICE_ID) setDemoPhase("idle");
    setDeleteTarget(null);
    setToast(isSeed
      ? "已移除这条预置通知；刷新后也不会再出现。"
      : "已删除这条通知及其待办和提醒。删除只影响当前浏览器，无法跨设备恢复。");
  }

  function goMobileSection(section: MobileSection) {
    setMobileSection(section);
    setView("workbench");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBoard() {
    setMobileSection("tasks");
    setView("board");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchRole(nextRole: Role) {
    setRole(nextRole);
    setSelectedTaskId(null);
    if (nextRole === "student") {
      const run = runs[CLASS_NOTICE_ID];
      const started = Boolean(run) || states.student.demoComplete;
      setCurrentId(started ? CLASS_NOTICE_ID : "");
      setDemoPhase(run
        ? run.phase === "running"
          ? "extract"
          : run.phase === "failed"
            ? "failed"
            : run.phase === "complete"
              ? "complete"
              : "idle"
        : states.student.demoComplete ? "complete" : "idle");
    } else {
      setCurrentId(COUNSELOR_NOTICE_ID);
    }
    // Keep student demo status in memory, but do not show it on the other role.
  }

  function publishRun(run: PipelineRun) {
    setRuns((previous) => ({ ...previous, [run.noticeId]: run }));
  }

  async function runDemo() {
    if (demoBusy || !classNotice) return;
    const notice = classNotice;
    const startedAt = Date.now();
    const hadClassResults = states.student.demoComplete;
    setDemoBusy(true);
    setRole("student");
    setView("workbench");
    setMobileSection("tasks");
    setCurrentId(CLASS_NOTICE_ID);
    setSelectedTaskId(null);
    updateRoleState("student", (state) => ({ ...state, demoComplete: false }));
    setDemoPhase("ingest");

    const base = createPipelineRun({
      noticeId: notice.id,
      source: "demo",
      role: "student",
      sourceType: notice.sourceType,
      roleLabel: "学生",
      sourceLabel: sourceLabels[notice.sourceType],
      bodyLength: notice.body.length,
      today,
      startedAt,
    });
    let run = appendPipelineLog(
      {
        ...base,
        phase: "running",
        stages: {
          ...base.stages,
          ingest: { status: "done", note: `已接收 ${notice.body.length} 字原文` },
          request: { status: "active", note: "检查字段、来源与正文长度" },
        },
      },
      `接收学生的${sourceLabels[notice.sourceType]}原文，共 ${notice.body.length} 字。`,
    );
    publishRun(run);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 140));

    run = patchPipelineStage(run, "request", { status: "done", note: "四个字段、来源与长度检查通过" });
    run = patchPipelineStage(run, "agent", { status: "active", note: "Qoder Cloud Agent 正在拆解" });
    run = appendPipelineLog(run, "请求门闸通过，已发送到同源拆解函数。");
    publishRun(run);
    setDemoPhase("extract");

    const requestStartedAt = performance.now();
    let currentStage: PipelineStageId = "agent";
    try {
      const result = await extractTasks(
        { role: "student", today: localDateString(), sourceType: notice.sourceType, body: notice.body, images: [] },
        {
          noticeId: notice.id,
          doNotExtract: notice.doNotExtract,
          existingTasks: states.student.customTasks.filter((task) => task.noticeId !== CLASS_NOTICE_ID),
        },
      );
      const requestMs = Math.round(result.trace?.requestMs ?? performance.now() - requestStartedAt);
      const returned = result.trace?.returnedTasks ?? result.tasks.length;
      const mode = result.mode;

      run = patchPipelineStage(run, "agent", {
        status: "done",
        note: `${pipelineModeLabel(mode)} · 返回 ${returned} 条`,
        durationMs: requestMs,
      });
      run = appendPipelineLog(
        run,
        `${pipelineModeLabel(mode)} 返回 ${returned} 条候选，请求耗时 ${requestMs} ms。`,
        mode === "cloud_agent" ? "ok" : "info",
      );
      publishRun(run);

      const verification = verifyLabResult(notice.body, result.tasks);

      currentStage = "quotes";
      run = patchPipelineStage(run, "quotes", { status: "active", note: "逐条回查原文位置" });
      run = appendPipelineLog(run, "开始回查每条任务的原文摘录。");
      publishRun(run);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 240));
      run = patchPipelineStage(run, "quotes", {
        status: "done",
        note: `${verification.quoteOk}/${verification.total} 条摘录可连续定位`,
      });
      run = appendPipelineLog(
        run,
        verification.quoteBroken > 0
          ? `原文对账发现 ${verification.quoteBroken} 条摘录不能连续定位，已降级为待确认。`
          : `原文对账完成：${verification.quoteOk}/${verification.total} 条摘录可连续定位。`,
        verification.quoteBroken > 0 ? "fail" : "ok",
      );
      publishRun(run);

      currentStage = "dates";
      run = patchPipelineStage(run, "dates", { status: "active", note: "核对截止日期的原文依据" });
      run = appendPipelineLog(run, "开始核对截止日期与原文时间表述。");
      publishRun(run);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
      run = patchPipelineStage(run, "dates", {
        status: "done",
        note: `${verification.dated} 个明确日期 · ${verification.needsConfirm} 条待确认`,
      });
      run = appendPipelineLog(
        run,
        `日期落地完成：${verification.dated} 个明确日期，${verification.needsConfirm} 条待确认。`,
        verification.needsConfirm > 0 ? "info" : "ok",
      );
      publishRun(run);

      currentStage = "assemble";
      setDemoPhase("write");
      run = patchPipelineStage(run, "assemble", { status: "active", note: "合并并装配待办" });
      run = appendPipelineLog(run, "开始合并候选并应用去重规则。");
      publishRun(run);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));

      const gated = gateExtractedTasks({
        body: notice.body,
        role: "student",
        noticeId: CLASS_NOTICE_ID,
        tasks: result.tasks,
        doNotExtract: notice.doNotExtract,
        origin: mode,
      });
      if (gated.length === 0) {
        run = patchPipelineStage(run, "assemble", { status: "failed", note: "没有通过门闸的任务" });
        run = appendPipelineLog(run, "装配中断：没有通过原文与日期门闸的任务，未写入待办。", "fail");
        run = {
          ...run,
          phase: "failed",
          verification,
          returnedTasks: returned,
          error: "没有得到可核对的任务，未写入待办。",
          elapsedMs: Math.round(Date.now() - startedAt),
        };
        publishRun(run);
        setDemoPhase("failed");
        updateRoleState("student", (state) => ({ ...state, demoComplete: hadClassResults }));
        setToast("没有通过核对的任务，未写入待办。");
        return;
      }

      run = patchPipelineStage(run, "assemble", {
        status: "done",
        note: `${returned} 条候选 → ${gated.length} 条待办`,
        durationMs: result.trace?.gateMs,
      });
      updateRoleState("student", (state) => ({
        ...state,
        demoComplete: true,
        customTasks: [...state.customTasks.filter((task) => task.noticeId !== CLASS_NOTICE_ID), ...gated],
      }));
      run = {
        ...run,
        phase: "complete",
        mode,
        verification,
        returnedTasks: returned,
        taskCount: gated.length,
        elapsedMs: Math.round(Date.now() - startedAt),
      };
      run = appendPipelineLog(run, `核对与装配完成：${gated.length} 条待办已写入当前通知。`, "ok");
      publishRun(run);
      setSelectedTaskId(gated[0].id);
      setDemoPhase("complete");
      setToast(mode === "cloud_agent"
        ? "Cloud Agent 拆解完成，结果已保存到本机。"
        : mode === "local_fixture"
          ? "已导入本地核对样例；本次未调用 Cloud Agent。"
          : "已写入离线已核对任务；本次未调用 Cloud Agent。");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "处理失败，未写入待办。";
      run = patchPipelineStage(run, currentStage, { status: "failed", note: "未完成" });
      run = appendPipelineLog(run, `拆解中断：${message}`, "fail");
      run = {
        ...run,
        phase: "failed",
        error: message,
        elapsedMs: Math.round(Date.now() - startedAt),
      };
      publishRun(run);
      setDemoPhase("failed");
      updateRoleState("student", (state) => ({ ...state, demoComplete: hadClassResults }));
      setToast("在线拆解失败，未自动改用离线结果。");
    } finally {
      setDemoBusy(false);
    }
  }

  function useOfflineDemo() {
    if (demoBusy || !classNotice) return;
    const notice = classNotice;
    const offlineTasks = gateExtractedTasks({
      body: notice.body,
      role: "student",
      noticeId: CLASS_NOTICE_ID,
      tasks: seedTasks.filter((task) => task.noticeId === CLASS_NOTICE_ID),
      doNotExtract: notice.doNotExtract,
      origin: "verified_offline",
    });
    if (offlineTasks.length === 0) {
      setToast("离线样例没有通过当前门闸，请检查样例数据。");
      return;
    }
    const verification = verifyLabResult(notice.body, offlineTasks);
    const base = runs[notice.id] ?? idleDemoRun ?? createPipelineRun({
      noticeId: notice.id,
      source: "demo",
      role: "student",
      sourceType: notice.sourceType,
      roleLabel: "学生",
      sourceLabel: sourceLabels[notice.sourceType],
      bodyLength: notice.body.length,
      today,
    });
    let run: PipelineRun = {
      ...base,
      phase: "complete",
      mode: "verified_offline",
      startedAt: Date.now(),
      elapsedMs: 0,
      stages: {
        ingest: { status: "done", note: `已接收 ${notice.body.length} 字原文` },
        request: { status: "done", note: "四个字段、来源与长度检查通过" },
        agent: { status: "skipped", note: "按用户选择跳过在线 Agent，未调用模型" },
        quotes: { status: "done", note: `${verification.quoteOk}/${verification.total} 条摘录可连续定位` },
        dates: { status: "done", note: `${verification.dated} 个明确日期 · ${verification.needsConfirm} 条待确认` },
        assemble: { status: "done", note: `${offlineTasks.length} 条离线已核对任务写入当前通知` },
      },
      logs: [],
      verification,
      returnedTasks: offlineTasks.length,
      taskCount: offlineTasks.length,
      error: "",
    };
    run = appendPipelineLog(run, "已选择离线已核对样例；本次不会调用 Cloud Agent。", "info");
    run = appendPipelineLog(run, `原文对账完成：${verification.quoteOk}/${verification.total} 条摘录可连续定位。`, "ok");
    run = appendPipelineLog(
      run,
      `日期落地完成：${verification.dated} 个明确日期，${verification.needsConfirm} 条待确认。`,
      verification.needsConfirm > 0 ? "info" : "ok",
    );
    run = appendPipelineLog(run, `装配完成：${offlineTasks.length} 条待办已写入当前通知。`, "ok");
    publishRun(run);
    updateRoleState("student", (state) => ({
      ...state,
      demoComplete: true,
      customTasks: [...state.customTasks.filter((task) => task.noticeId !== CLASS_NOTICE_ID), ...offlineTasks],
    }));
    setRole("student");
    setView("workbench");
    setMobileSection("tasks");
    setCurrentId(notice.id);
    setSelectedTaskId(offlineTasks[0].id);
    setDemoPhase("complete");
    setToast("已使用离线已核对样例；本次未调用 Cloud Agent。");
  }

  function toggleRead() {
    if (!currentNotice) return;
    updateRoleState(role, (state) => ({ ...state, read: { ...state.read, [currentNotice.id]: !currentNotice.read } }));
    setToast(currentNotice.read ? "已标为未读，任务状态未改变。" : "已标为已读，任务仍保持未完成。");
  }

  function toggleDone(task: Task) {
    const done = task.status !== "done";
    updateRoleState(task.role, (state) => ({ ...state, done: { ...state.done, [task.id]: done } }));
    setToast(done ? "任务已完成，原文依据仍可查看。" : "任务已恢复为待完成。");
  }

  function locateTask(task: Task) {
    setRole(task.role);
    setView("workbench");
    setMobileSection("tasks");
    setCurrentId(task.noticeId);
    setSelectedTaskId(task.id);
    if (task.role === "student" && task.noticeId === CLASS_NOTICE_ID) setDemoPhase("complete");
  }

  function imported(notice: Notice, importedTasks: Task[], mode: ExtractionResult["mode"], run: PipelineRun) {
    updateRoleState(notice.role, (state) => ({
      ...state,
      customNotices: [...state.customNotices, notice],
      customTasks: [...state.customTasks, ...importedTasks],
    }));
    setRole(notice.role);
    setCurrentId(notice.id);
    setSelectedTaskId(importedTasks[0]?.id ?? null);
    setView("workbench");
    setMobileSection("tasks");
    setSessionNoticeIds((ids) => (ids.includes(notice.id) ? ids : [...ids, notice.id]));
    publishRun(run);
    setPasteOpen(false);
    setToast(mode === "cloud_agent"
      ? "Cloud Agent 拆解完成，结果已保存到本机。"
      : mode === "local_fixture"
        ? "已导入本地核对样例；本次未调用 Cloud Agent。"
        : "已导入离线已核对结果；本次未调用 Cloud Agent。");
  }

  function saveReview(session: IntakeSession, outcome: ApplyReviewOutput, manualSkipped: number) {
    const targetRole = session.role;
    updateRoleState(targetRole, (state) => ({
      ...state,
      customNotices: [...state.customNotices, session.notice],
      customTasks: [...state.customTasks, ...outcome.newTasks],
      taskPatches: { ...state.taskPatches, ...outcome.patches },
      reminders: { ...state.reminders, ...outcome.reminders },
    }));
    const summary = describeReviewOutcome(outcome, manualSkipped);
    const finishedRun = patchPipelineStage({
      ...session.run,
      phase: "complete",
      mode: session.mode,
      returnedTasks: session.tasks.length,
      taskCount: outcome.newTasks.length,
      summary,
      elapsedMs: session.run.startedAt ? Date.now() - session.run.startedAt : session.run.elapsedMs,
      error: "",
    }, "assemble", { status: "done", note: summary });
    publishRun(appendPipelineLog(finishedRun, `保存完成：${summary}。`, outcome.newTasks.length > 0 ? "ok" : "info"));
    setRole(targetRole);
    setView("workbench");
    setMobileSection(sectionAfterSave());
    setCurrentId(session.notice.id);
    setSelectedTaskId(outcome.newTasks[0]?.id ?? null);
    setSessionNoticeIds((ids) => (ids.includes(session.notice.id) ? ids : [...ids, session.notice.id]));
    setReviewSession(null);
    setIntakeResetSignal((value) => value + 1);

    const reminderCount = Object.keys(outcome.reminders).length;
    const reminderNote = reminderCount > 0 ? `；${reminderCount} 条提醒已保存，标签页打开时生效` : "";
    setToast(`通知已保存：${summary}${reminderNote}。本批草稿已清空。`);
  }

  async function requestNotificationPermission() {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      setToast("当前浏览器不支持系统通知；页面内收件箱仍可用。");
      return;
    }
    if (Notification.permission === "denied") {
      setNotificationPermission("denied");
      setToast("系统通知已被拒绝，浏览器不会再弹出授权框；请在地址栏的站点设置里改为允许。");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(toNotificationState(permission));
      setToast(permission === "granted"
        ? "系统通知已允许：标签页保持打开时，切到其他窗口也会提醒；关闭网页后无法再提醒。"
        : permission === "denied"
          ? "系统通知已被拒绝：浏览器不会再弹出授权框，可在站点设置里修改；页面内收件箱仍可用。"
          : "系统通知仍未授权；页面内收件箱仍可用。");
    } catch {
      setToast("浏览器没有完成授权请求；系统通知状态未变，页面内收件箱仍可用。");
    }
  }

  async function sendTestNotification() {
    if (notificationPermission !== "granted") {
      setToast(`${notificationFailureReason(notificationPermission)}；无法发送测试通知。`);
      return;
    }
    setNotificationTesting(true);
    const title = "测试通知：通知任务台";
    const body = "看到这条说明系统通知可用；待办到点时也会这样提醒。关闭网页后不会继续提醒。";
    try {
      const registration = swRegistrationRef.current;
      if (registration) {
        await registration.showNotification(title, {
          body,
          tag: "notice-desk-test",
          silent: false,
          data: { test: true },
        });
      } else {
        new Notification(title, { body, tag: "notice-desk-test", silent: false });
      }
      setToast("测试通知已发出。若没有看到，请检查系统勿扰模式和浏览器的站点通知设置。");
    } catch {
      setToast("测试通知发送失败：浏览器没有接受通知请求，请检查站点通知设置。");
    } finally {
      setNotificationTesting(false);
    }
  }

  function handleReminderNow(task: Task) {
    applyReminderAction(task.role, task, "now");
  }

  function handleTourEvent(event: TourEvent) {
    setTourStep((current) => applyTourEvent(current, event));
  }

  function startFromJudge(mode: "tour" | "own") {
    setJudgeOpen(false);
    setMobileSection("intake");
    if (mode === "tour") {
      setIntakeDemoSignal((value) => value + 1);
      setTourStep(0);
      setToast("演示通知正在载入；看到草稿后，按引导点「整理这批通知」。");
    } else {
      setIntakeFocusSignal((value) => value + 1);
      setToast("「添加通知」已准备好：粘贴文字或添加截图，再点「整理这批通知」。");
    }
  }

  function exitTour() {
    const finished = tourStep !== null && tourStep >= TOUR_STEPS.length - 1;
    setTourStep(null);
    setToast(finished
      ? "引导已结束；已保存的通知留在通知列表和看板，本批草稿在保存成功后已清空。"
      : "引导已结束；当前草稿和已保存的通知都会保留。");
  }

  function handleReminderPostpone(task: Task, until: string) {
    updateRoleState(task.role, (state) => {
      const reminder = state.reminders[task.id] ?? { at: until, lead: "custom" as const, notifiedAt: null, acknowledgedAt: null, postponedUntil: null };
      return { ...state, reminders: { ...state.reminders, [task.id]: postponeReminder(reminder, until) } };
    });
    setToast(`已推迟到 ${formatDateTime(until)}；在此之前不会重复提醒。`);
  }

  const header = (
    <header className="app-header compact-header">
      <button type="button" className="brand" onClick={() => goMobileSection("tasks")} aria-label="通知任务台首页">
        <span className="brand-mark"><CheckCheck size={18} /></span>
        <span><strong>通知任务台</strong><small>待办</small></span>
      </button>
      <div className="role-switch" aria-label="切换角色">
        <button type="button" className={role === "student" ? "active" : ""} onClick={() => switchRole("student")}>学生</button>
        <button type="button" className={role === "counselor" ? "active" : ""} onClick={() => switchRole("counselor")}>辅导员</button>
      </div>
      <button type="button" className="judge-entry" onClick={() => setJudgeOpen(true)}>
        <GraduationCap size={15} />评委用户快速了解请点我
      </button>
      <nav className="main-nav slim-nav desktop-nav" aria-label="主导航">
        <button type="button" className={view === "workbench" ? "active" : ""} aria-label="通知：桌面工作台，对应手机「待办」" title="桌面工作台：通知与待办；手机请用「待办」" onClick={() => setView("workbench")}><Inbox size={15} />通知</button>
        <button type="button" className={view === "board" ? "active" : ""} aria-label="看板：全部待办，对应手机「待办」" title="桌面看板：全部待办；手机请用「待办」" onClick={() => setView("board")}><LayoutDashboard size={15} />看板</button>
      </nav>
    </header>
  );

  const footer = (
    <footer className="app-footer">
      <span>演示数据为虚构；待办只保存在当前浏览器。「添加通知」默认整理你自己的通知，模拟消息源仅用于演示。</span>
      <span>提醒需要网页保持打开：标签页开着时可用系统通知，关闭网页后无法继续提醒。</span>
    </footer>
  );

  const SourceIcon = currentNotice ? NOTICE_SOURCE_ICONS[currentNotice.sourceType] : MessageSquareText;
  const pendingCount = visibleTasks.filter((task) => task.status === "todo" && task.category !== "fyi").length;
  const activeMobileSection: MobileSection = view === "board" ? "tasks" : mobileSection;

  const mobileNav = (
    <nav className="mobile-section-nav" aria-label="手机分区导航">
      {MOBILE_SECTIONS.map((section) => {
        const Icon = section.id === "intake" ? ClipboardPaste : section.id === "tasks" ? ListTodo : FileText;
        const active = activeMobileSection === section.id;
        return (
          <button
            type="button"
            key={section.id}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
            aria-label={`${section.label}：${section.hint}`}
            onClick={() => goMobileSection(section.id)}
          >
            <Icon size={16} />
            <span>{section.label}</span>
            {section.id === "tasks" && pendingCount > 0 && <span className="mobile-nav-count">{pendingCount}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className={`app-shell mobile-section-${activeMobileSection}`}>
      {mobileNav}
      <div className="stage-split">
        <div className="app-pane">
          {header}

          <div className="mobile-reminder-slot">
            <ReminderInbox
              tasks={visibleTasks}
              reminders={roleState.reminders}
              today={today}
              permission={notificationPermission}
              testing={notificationTesting}
              onLocate={locateTask}
              onNow={handleReminderNow}
              onPostpone={handleReminderPostpone}
              onRequestPermission={() => void requestNotificationPermission()}
              onTestNotification={() => void sendTestNotification()}
            />
          </div>

          {view === "workbench" ? (
              <main className="workbench-page">
                <TodayFocus
                  tasks={visibleTasks}
                  reminders={roleState.reminders}
                  today={today}
                  permission={notificationPermission}
                  testing={notificationTesting}
                  onLocate={locateTask}
                  onNow={handleReminderNow}
                  onPostpone={handleReminderPostpone}
                  onRequestPermission={() => void requestNotificationPermission()}
                  onTestNotification={() => void sendTestNotification()}
                  onViewAll={goBoard}
                />

                <div className="workspace app-workspace">
                  <NoticeList notices={inboxNotices} tasks={visibleTasks} currentId={currentNotice?.id ?? ""} onSelect={selectNotice} onDelete={(notice) => setDeleteTarget(notice)} />
                  <section className="panel tasks-panel" aria-label="通知与待办">
                    {inboxNotices.length > 0 && (
                      <div className="mobile-notice-switcher" aria-label="切换通知">
                        <div className="mobile-notice-switcher-head">
                          <span>当前通知 · {inboxNotices.length} 条</span>
                          <div className="mobile-notice-switcher-actions">
                            <button type="button" className="text-button" onClick={() => goMobileSection("source")}>
                              <Quote size={13} />看原文依据
                            </button>
                            {currentNotice && (
                              <button
                                type="button"
                                className="text-button mobile-notice-delete"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteTarget(currentNotice);
                                }}
                                aria-label={`删除当前通知：${currentNotice.title}`}
                              >
                                <Trash2 size={13} />删除这条通知
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mobile-notice-chips">
                          {inboxNotices.map((notice) => {
                            const pending = visibleTasks.filter((task) => task.noticeId === notice.id && task.status === "todo" && task.category !== "fyi").length;
                            return (
                              <button
                                type="button"
                                key={notice.id}
                                className={notice.id === currentNotice?.id ? "active" : ""}
                                aria-pressed={notice.id === currentNotice?.id}
                                onClick={() => selectNotice(notice.id)}
                              >
                                <span>{notice.title}</span>
                                <small>{pending > 0 ? `${pending} 件待办` : "暂无待办"}</small>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {currentNotice ? (
                      <>
                        <div className="notice-summary">
                          <div className="notice-summary-bar">
                            <span className="notice-source-chip">
                              <SourceIcon size={12} aria-hidden="true" />
                              {currentNotice.sourceLabel}
                            </span>
                            <span className={`notice-read-chip ${currentNotice.read ? "read" : "unread"}`}>
                              <span className={`unread-dot ${currentNotice.read ? "read" : ""}`} aria-hidden="true" />
                              {currentNotice.read ? "已读" : "未读"}
                            </span>
                            <span className="notice-time">{formatReceivedAt(currentNotice.receivedAt)}</span>
                            <button type="button" className="notice-read-toggle" onClick={toggleRead}>
                              {currentNotice.read ? <Mail size={12} aria-hidden="true" /> : <MailOpen size={12} aria-hidden="true" />}
                              {currentNotice.read ? "标为未读" : "标为已读"}
                            </button>
                          </div>
                          <h2>{currentNotice.title}</h2>
                          <p className="notice-principle">
                            <CheckCheck size={12} aria-hidden="true" />
                            已读 ≠ 已完成，完成状态按待办单独记录
                          </p>
                        </div>
                        {currentRun && (
                          <PipelinePanel
                            run={currentRun}
                            expanded={traceExpanded}
                            onToggle={() => setTraceExpanded((open) => !open)}
                            onRetry={role === "student" && currentNotice.id === CLASS_NOTICE_ID ? () => void runDemo() : undefined}
                            onUseOffline={role === "student" && currentNotice.id === CLASS_NOTICE_ID ? useOfflineDemo : undefined}
                            retryDisabled={demoBusy}
                          />
                        )}
                        <div className="panel-heading"><div><ListTodo size={16} /><h2>待办</h2></div><span>{currentTasks.length} 条</span></div>
                        <div className="task-list">
                          {currentTasks.length === 0 ? (
                            <div className="empty-tasks">
                              <ListTodo size={18} aria-hidden="true" />
                              <div>
                                <strong>{currentRun?.phase === "running" ? "流水线正在拆解…" : "这条通知已保存，但没有需要办理的待办。"}</strong>
                                <p>{currentRun?.phase === "running" ? "完成后待办会出现在这里。" : "可能是仅阅知或被跳过的候选；原文与截图仍保留，可回到「添加通知」继续补充。"}</p>
                              </div>
                              {currentRun?.phase !== "running" && (
                                <button type="button" className="text-button" onClick={() => goMobileSection("intake")}>回到「添加通知」</button>
                              )}
                            </div>
                          ) : currentTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              today={today}
                              sourceLabel={currentNotice.sourceLabel}
                              sourceBody={currentNotice.body}
                              screenshots={currentNotice.screenshots}
                              selected={selectedTaskId === task.id}
                              onSelect={() => setSelectedTaskId(task.id)}
                              onToggleDone={() => toggleDone(task)}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="empty-tasks">
                        <Inbox size={18} aria-hidden="true" />
                        <div>
                          <strong>收件箱还是空的</strong>
                          <p>把群消息或邮件文字、截图放到「添加通知」，核对后会出现在这里。</p>
                        </div>
                        <button type="button" className="text-button" onClick={() => goMobileSection("intake")}>去添加通知</button>
                      </div>
                    )}
                  </section>
                </div>
                {currentNotice ? (
                  <div className="mobile-source-only">
                    <NoticeArticle
                      notice={currentNotice}
                      selectedTask={selectedTask}
                      onToggleRead={toggleRead}
                      onBack={() => goMobileSection("tasks")}
                    />
                  </div>
                ) : (
                  <div className="mobile-source-only mobile-source-empty">
                    <FileText size={26} />
                    <strong>还没有可回看的原文</strong>
                    <p>保存一条通知后，原文摘录、截图和逐条依据会出现在这里，方便核对。</p>
                    <button type="button" className="primary-button" onClick={() => goMobileSection("intake")}>
                      <ClipboardPaste size={15} />去添加通知
                    </button>
                  </div>
                )}
              </main>
            ) : (
              <TaskBoard
                tasks={visibleTasks}
                notices={inboxNotices}
                today={today}
                reminderInbox={(
                  <ReminderInbox
                    tasks={visibleTasks}
                    reminders={roleState.reminders}
                    today={today}
                    permission={notificationPermission}
                    testing={notificationTesting}
                    onLocate={locateTask}
                    onNow={handleReminderNow}
                    onPostpone={handleReminderPostpone}
                    onRequestPermission={() => void requestNotificationPermission()}
                    onTestNotification={() => void sendTestNotification()}
                  />
                )}
                onToggleDone={toggleDone}
                onDetail={(task) => locateTask(task)}
                onLocate={locateTask}
              />
            )}

          {footer}
        </div>

        <IntakeDesk
          role={role}
          today={today}
          existingTasks={tasks}
          sourceNotice={sourceNotice}
          demoPhase={demoPhase}
          busy={demoBusy}
          demoSignal={intakeDemoSignal}
          focusSignal={intakeFocusSignal}
          resetSignal={intakeResetSignal}
          onSimulate={() => void runDemo()}
          onManualTest={() => setPasteOpen(true)}
          onReview={setReviewSession}
          onTourEvent={handleTourEvent}
          onToast={setToast}
        />
      </div>

      {reviewSession && (
        <ReviewDialog
          key={reviewSession.notice.id}
          session={reviewSession}
          existingTasks={reviewExistingTasks}
          permission={notificationPermission}
          onRequestPermission={() => void requestNotificationPermission()}
          onTestNotification={() => void sendTestNotification()}
          onTourEvent={handleTourEvent}
          onClose={() => setReviewSession(null)}
          onConfirm={saveReview}
        />
      )}
      <PasteDialog open={pasteOpen} role={role} existingTasks={roleState.customTasks} onClose={() => setPasteOpen(false)} onImported={imported} />
      {judgeOpen && <JudgeDialog onClose={() => setJudgeOpen(false)} onStart={startFromJudge} />}
      {tourStep !== null && <TourCoach step={tourStep} onStep={setTourStep} onExit={exitTour} />}
      {deleteTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeleteTarget(null);
          }}
        >
          <section className="modal delete-notice-modal" role="dialog" aria-modal="true" aria-labelledby="delete-notice-title">
            <h2 id="delete-notice-title">删除这条通知？</h2>
            <p className="modal-intro">删除后，这条通知以及它下面的待办、提醒都会从当前浏览器移除；不可跨设备恢复。</p>
            <div className="delete-notice-target">
              <strong>{deleteTarget.title}</strong>
              <span>{deleteTarget.sourceLabel}</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button type="button" className="danger-button" onClick={confirmDeleteNotice}>
                <Trash2 size={14} />删除通知
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    </div>
  );
}
