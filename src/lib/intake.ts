import type { ExtractionResult, IgnoredItem, ImageFailure, ImageRead, Notice, Role, SourceImage, SourceType, Task } from "../types";
import type { PipelineRun } from "./pipeline";

export interface IntakeSession {
  role: Role;
  sourceType: SourceType;
  sourceLabel: string;
  segments: string[];
  images: SourceImage[];
  notice: Notice;
  tasks: Task[];
  imageReads: ImageRead[];
  ignored: IgnoredItem[];
  mode: ExtractionResult["mode"];
  returned: number;
  run: PipelineRun;
  imageFailures?: ImageFailure[];
}

export function emptyIntakeDraft() {
  return { segments: [] as string[], pending: "", images: [] };
}

export const INTAKE_SOURCE_LABELS: Record<SourceType, string> = {
  wechat_group: "手动整理 · 班级群",
  dingtalk_or_wecom: "手动整理 · 课程 / 工作群",
  email: "手动整理 · 邮件",
  paste: "手动整理 · 粘贴",
};