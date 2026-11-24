import type { ExtractionImage, ExtractionRequest } from "../types";

// Mirrors functions/handler.ts so the browser can explain a request before it is sent.
export const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
export const MAX_TEXT_CHARS = 12_000;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BASE64_CHARS = 3_500_000;
export const MAX_TOTAL_IMAGE_BASE64_CHARS = 8_000_000;

type BudgetInput = Pick<ExtractionRequest, "body" | "images">;

export function extractionRequestBody(request: ExtractionRequest) {
  return JSON.stringify(request);
}

export function extractionRequestBytes(request: ExtractionRequest) {
  return new TextEncoder().encode(extractionRequestBody(request)).byteLength;
}

function megabytes(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Returns a Chinese, actionable error when the request cannot fit the
 * handler limits, or null when it is safe to send.
 */
export function preflightExtractionBudget(input: BudgetInput): string | null {
  const images: ExtractionImage[] = input.images ?? [];
  if (images.length > MAX_IMAGES) {
    return `一次最多整理 ${MAX_IMAGES} 张截图；请删掉多出的图片后再试。`;
  }
  if (input.body.length > MAX_TEXT_CHARS) {
    return `文字总长度不能超过 ${MAX_TEXT_CHARS} 字，请删减后再整理。`;
  }
  if (images.some((image) => image.data.length > MAX_IMAGE_BASE64_CHARS)) {
    return "有一张截图超过单张体积上限，请先压缩，或只截取通知的关键部分后再试。";
  }
  const totalImageChars = images.reduce((total, image) => total + image.data.length, 0);
  if (totalImageChars > MAX_TOTAL_IMAGE_BASE64_CHARS) {
    return `截图总大小超过上限（约 ${megabytes(MAX_TOTAL_IMAGE_BASE64_CHARS)} MB）；请删掉部分图片或先压缩。`;
  }
  const bytes = extractionRequestBytes({
    role: "student",
    today: "2026-01-01",
    sourceType: "paste",
    body: input.body,
    images,
  });
  if (bytes > MAX_REQUEST_BYTES) {
    return `文字和截图合计约 ${megabytes(bytes)} MB，超过本站 ${megabytes(MAX_REQUEST_BYTES)} MB 的请求上限；`
      + "请删掉部分截图、压缩图片或改用文字后再试。";
  }
  return null;
}