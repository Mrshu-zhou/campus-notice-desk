import type { ExtractionRequest, ExtractionResult, ImageFailure, IgnoredItem, ImageRead, Task } from "../types";

export interface BatchExtractionResult extends ExtractionResult {
  imageFailures: ImageFailure[];
}

export interface BatchExtractionOptions {
  noticeId?: string;
  existingTasks?: Task[];
  doNotExtract?: string[];
  keepExistingDuplicates?: boolean;
  imageLabels?: Record<string, string>;
}

type ExtractFn = (request: ExtractionRequest, options: BatchExtractionOptions) => Promise<ExtractionResult>;

function taskKey(task: Task) {
  return [task.title, task.action, task.deadline ?? "", task.deadlineText ?? "", task.sourceQuote ?? "", task.sourceImageId ?? ""].join("|");
}

function imageReadKey(read: ImageRead) {
  return `${read.imageId}|${read.text}`;
}

function ignoredKey(item: IgnoredItem) {
  return `${item.reason}|${item.text}`;
}

/**
 * Merges per-image results without dropping successful images when another
 * image times out. Task/read dedupe keeps the same item from appearing twice.
 */
export function mergeExtractionResults(
  results: ExtractionResult[],
  imageFailures: ImageFailure[] = [],
  imageCount = 0,
): BatchExtractionResult {
  const tasks: Task[] = [];
  const taskKeys = new Set<string>();
  const imageReads: ImageRead[] = [];
  const imageReadKeys = new Set<string>();
  const ignored: IgnoredItem[] = [];
  const ignoredKeys = new Set<string>();

  results.forEach((result) => {
    result.tasks.forEach((task) => {
      const key = taskKey(task);
      if (taskKeys.has(key)) return;
      taskKeys.add(key);
      tasks.push(task);
    });
    result.imageReads.forEach((read) => {
      const key = imageReadKey(read);
      if (imageReadKeys.has(key)) return;
      imageReadKeys.add(key);
      imageReads.push(read);
    });
    result.ignored.forEach((item) => {
      const key = ignoredKey(item);
      if (ignoredKeys.has(key)) return;
      ignoredKeys.add(key);
      ignored.push(item);
    });
  });

  const traces = results.flatMap((result) => result.trace ? [result.trace] : []);
  const mode = results.every((result) => result.mode === "cloud_agent")
    ? "cloud_agent"
    : results[0]?.mode ?? "verified_offline";

  return {
    tasks,
    mode,
    imageReads,
    ignored,
    imageFailures,
    trace: {
      requestMs: traces.reduce((total, trace) => total + trace.requestMs, 0),
      gateMs: traces.reduce((total, trace) => total + trace.gateMs, 0),
      returnedTasks: traces.reduce((total, trace) => total + trace.returnedTasks, 0),
      acceptedTasks: tasks.length,
      imageCount,
    },
  };
}

export function isLikelyBatchTimeout(message: string) {
  return /504|超时|timeout|aborted|网关/i.test(message);
}

export function describeImageFailures(failures: ImageFailure[]) {
  if (failures.length === 0) return "";
  const labels = failures.map((failure) => failure.label).join("、");
  const timeoutNote = failures.some((failure) => isLikelyBatchTimeout(failure.message))
    ? "（多张截图一次整理时，服务端容易超时）"
    : "";
  return `${labels}没有完成拆解${timeoutNote}。已成功的结果仍可核对，草稿也保留；建议返回修改后一张一张重试，不会写入假结果。`;
}

/**
 * For 2+ screenshots, send each image separately so one gateway timeout does
 * not discard the whole batch. Text is sent once without images first.
 */
export async function extractTasksByImage(
  request: ExtractionRequest,
  options: BatchExtractionOptions,
  extract: ExtractFn,
): Promise<BatchExtractionResult> {
  const images = request.images ?? [];
  if (images.length < 2) {
    const result = await extract(request, options);
    return { ...result, imageFailures: [] };
  }

  const results: ExtractionResult[] = [];
  const failures: ImageFailure[] = [];
  let carriedTasks = [...(options.existingTasks ?? [])];

  const runOne = async (unit: ExtractionRequest, label: string, imageId: string | null) => {
    try {
      const result = await extract(unit, { ...options, existingTasks: carriedTasks });
      results.push(result);
      carriedTasks = [...carriedTasks, ...result.tasks];
    } catch (error) {
      failures.push({
        imageId,
        label,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (request.body.trim()) {
    await runOne({ ...request, images: [] }, "通知文字", null);
  }
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const name = options.imageLabels?.[image.id]?.trim();
    await runOne(
      { ...request, body: "", images: [image] },
      name ? `截图「${name}」` : `第 ${index + 1} 张截图`,
      image.id,
    );
  }

  if (results.length === 0) {
    const detail = failures.map((failure) => `${failure.label}：${failure.message}`).join("；");
    throw new Error(`这批内容都没有完成拆解（${detail}）。草稿仍保留；一次整理多张截图容易超时，建议先改为一张一张整理后重试。`);
  }

  return mergeExtractionResults(results, failures, images.length);
}