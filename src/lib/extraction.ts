import { gateExtractedTasks } from "./gates";
import type { ExtractionRequest, ExtractionResult, IgnoredItem, ImageRead, Task } from "../types";
import { parseExtractionMode } from "./extraction-mode";
export { originCaption, parseExtractionMode } from "./extraction-mode";

interface ExtractOptions {
  noticeId?: string;
  existingTasks?: Task[];
  doNotExtract?: string[];
  keepExistingDuplicates?: boolean;
}

const IGNORED_REASONS = new Set<IgnoredItem["reason"]>(["chat", "knowledge", "acknowledgement", "duplicate", "unrelated", "other"]);

function parseImageReads(value: unknown): ImageRead[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("截图转写结果格式不正确，已停止导入。");
  return value.map((item) => {
    const record = item as Partial<ImageRead>;
    if (!record || typeof record.imageId !== "string" || typeof record.text !== "string"
      || typeof record.uncertain !== "boolean" || typeof record.notes !== "string") {
      throw new Error("截图转写结果格式不正确，已停止导入。");
    }
    return { imageId: record.imageId, text: record.text, uncertain: record.uncertain, notes: record.notes };
  });
}

function parseIgnored(value: unknown): IgnoredItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("未生成待办的说明格式不正确，已停止导入。");
  return value.flatMap((item) => {
    const record = item as Partial<IgnoredItem>;
    if (!record || typeof record.text !== "string" || typeof record.reason !== "string") return [];
    return IGNORED_REASONS.has(record.reason as IgnoredItem["reason"])
      ? [{ text: record.text, reason: record.reason as IgnoredItem["reason"] }]
      : [];
  });
}

export async function extractTasks(request: ExtractionRequest, options: ExtractOptions = {}): Promise<ExtractionResult> {
  const images = request.images ?? [];
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 130_000);
  const requestStartedAt = performance.now();
  try {
    const response = await fetch("/functions/v1/app?action=extract", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...request, images }),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const local = typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname);
      throw new Error(local
        ? `本地预览没有连接到本仓库拆解函数（HTTP ${response.status}），本次未写入任何结果。请确认 npm run dev:function:node 已在 8001 启动；公开站点才走 Cloud Agent。`
        : `拆解服务没有返回可用结果（HTTP ${response.status}），本次未写入任何结果。一次整理多张截图更容易超时，建议改为一张一张整理；草稿仍保留，请稍后重试。`);
    }
    const result = await response.json();
    const requestMs = Math.round(performance.now() - requestStartedAt);
    if (!response.ok || !result.ok) {
      if (response.status === 413 || result.error === "request_too_large") {
        throw new Error("请求体过大（超过本站 9 MB 上限）。请删掉部分截图、压缩图片或改用文字后再试。");
      }
      throw new Error(result.message ?? "在线拆解暂时不可用，请稍后再试。预置通知仍可正常查看。");
    }
    const mode = parseExtractionMode(result.mode);
    if (!mode) {
      throw new Error("拆解结果缺少运行方式标识，已停止导入。");
    }
    if (!Array.isArray(result.tasks)) throw new Error("拆解结果缺少任务列表，已停止导入。");
    const imageReads = parseImageReads(result.imageReads);
    const ignored = parseIgnored(result.ignored);
    const gateStartedAt = performance.now();
    const gated = gateExtractedTasks({
      body: request.body,
      role: request.role,
      noticeId: options.noticeId ?? "",
      tasks: result.tasks,
      imageReads,
      existingTasks: options.existingTasks,
      doNotExtract: options.doNotExtract,
      origin: mode,
      keepExistingDuplicates: options.keepExistingDuplicates,
    });
    const tasks = gated.map((task) => ({
      ...task,
      id: `${request.role}-${task.id}-${crypto.randomUUID()}`,
    }));
    return {
      tasks,
      mode,
      imageReads,
      ignored,
      trace: {
        requestMs,
        gateMs: Math.round(performance.now() - gateStartedAt),
        returnedTasks: result.tasks.length,
        acceptedTasks: tasks.length,
        imageCount: images.length,
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("拆解等待超时（约 130 秒），已添加的文字和截图仍保留在草稿中。一次整理多张截图更容易超时，可以改为一张一张整理后重试。");
    }
    if (error instanceof TypeError) {
      throw new Error("无法连接拆解服务，请检查网络后重试；本次未写入任何结果。");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}