import type { LabVerification } from "./agent-lab";
import type { ExtractionResult, Role, SourceType } from "../types";

export type DemoPhase = "idle" | "ingest" | "classify" | "extract" | "write" | "complete" | "failed";
export type PipelineSource = "demo" | "manual";
export type PipelineRunPhase = "idle" | "running" | "complete" | "failed";
export type PipelineStageId = "ingest" | "request" | "agent" | "quotes" | "dates" | "assemble";
export type PipelineStageStatus = "idle" | "active" | "done" | "failed" | "skipped";
export type PipelineTone = "info" | "ok" | "fail";

export interface PipelineStageState {
  status: PipelineStageStatus;
  note: string;
  durationMs?: number;
}

export interface PipelineLogEntry {
  id: number;
  time: string;
  text: string;
  tone: PipelineTone;
}

export interface PipelineRun {
  noticeId: string;
  source: PipelineSource;
  role: Role;
  sourceType: SourceType;
  roleLabel: string;
  sourceLabel: string;
  bodyLength: number;
  today: string;
  phase: PipelineRunPhase;
  mode: ExtractionResult["mode"] | null;
  stages: Record<PipelineStageId, PipelineStageState>;
  logs: PipelineLogEntry[];
  verification: LabVerification | null;
  returnedTasks: number;
  taskCount: number;
  summary: string;
  startedAt: number;
  elapsedMs: number | null;
  error: string;
}

export const PIPELINE_STAGES = [
  { id: "ingest", label: "原文入站", note: "接收群聊或邮件原文" },
  { id: "request", label: "请求门闸", note: "字段、长度与来源检查" },
  { id: "agent", label: "智能拆解", note: "抽取候选任务" },
  { id: "quotes", label: "原文对账", note: "摘录必须连续可定位" },
  { id: "dates", label: "日期落地", note: "模糊时间降级待确认" },
  { id: "assemble", label: "装配待办", note: "去重合并后写入候选" },
] as const;

export const IDLE_STAGE_NOTES: Record<PipelineStageId, string> = {
  ingest: "点右侧「班长发来通知」后，原文会先进入这里。",
  request: "请求只接受角色、今天日期、来源和正文四个字段。",
  agent: "在线模式会真实调用 Qoder Cloud Agent；离线样例会明确标注。",
  quotes: "运行后会逐条检查任务摘录能否在原文中连续找到。",
  dates: "运行后会检查截止日期是否与原文时间表述一致。",
  assemble: "通过门闸的任务才会写入当前通知的待办。",
};

export const PIPELINE_MODE_LABELS: Record<ExtractionResult["mode"], string> = {
  cloud_agent: "Cloud Agent 在线拆解",
  local_fixture: "本地核对样例",
  verified_offline: "离线已核对",
};

export function pipelineModeLabel(mode: ExtractionResult["mode"] | null | undefined) {
  return mode ? PIPELINE_MODE_LABELS[mode] : "";
}

export function initialPipelineStages(): Record<PipelineStageId, PipelineStageState> {
  return PIPELINE_STAGES.reduce((all, stage) => ({
    ...all,
    [stage.id]: { status: "idle", note: "" },
  }), {} as Record<PipelineStageId, PipelineStageState>);
}

export function createPipelineRun(input: {
  noticeId: string;
  source: PipelineSource;
  role: Role;
  sourceType: SourceType;
  roleLabel: string;
  sourceLabel: string;
  bodyLength: number;
  today: string;
  startedAt?: number;
}): PipelineRun {
  return {
    ...input,
    phase: "idle",
    mode: null,
    stages: initialPipelineStages(),
    logs: [],
    verification: null,
    returnedTasks: 0,
    taskCount: 0,
    summary: "",
    startedAt: input.startedAt ?? 0,
    elapsedMs: null,
    error: "",
  };
}

export function patchPipelineStage(
  run: PipelineRun,
  stageId: PipelineStageId,
  patch: Partial<PipelineStageState>,
): PipelineRun {
  return {
    ...run,
    stages: {
      ...run.stages,
      [stageId]: { ...run.stages[stageId], ...patch },
    },
  };
}

export function appendPipelineLog(run: PipelineRun, text: string, tone: PipelineTone = "info"): PipelineRun {
  return {
    ...run,
    logs: [
      ...run.logs,
      {
        id: (run.logs.at(-1)?.id ?? 0) + 1,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        text,
        tone,
      },
    ],
  };
}

export function stageStatusLabel(status: PipelineStageStatus) {
  if (status === "active") return "运行中";
  if (status === "done") return "完成";
  if (status === "failed") return "中断";
  if (status === "skipped") return "跳过";
  return "待机";
}
