import type { SourceImage } from "../types";

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BASE64_CHARS = 3_500_000;
export const MAX_TOTAL_IMAGE_BASE64_CHARS = 8_000_000;

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const DEMO_SCREENSHOT_NAME = "实验室安全通知样例.png";
export const DEMO_SCREENSHOT_ID = "demo-lab-safety";

export function isDemoScreenshot(image: Pick<SourceImage, "id" | "name">) {
  return image.id === DEMO_SCREENSHOT_ID || image.name === DEMO_SCREENSHOT_NAME;
}

export function addDemoScreenshot(images: SourceImage[], demo: SourceImage) {
  return images.some(isDemoScreenshot) ? images : [...images, demo];
}

export function newImageId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `img${Date.now().toString(36).slice(-6)}${random}`.slice(0, 24);
}

function dataUrlToBase64(dataUrl: string) {
  const at = dataUrl.indexOf(",");
  if (at < 0) throw new Error("无法读取这张图片。");
  return dataUrl.slice(at + 1);
}

export function imageDataUrl(image: Pick<SourceImage, "mediaType" | "data">) {
  return `data:${image.mediaType};base64,${image.data}`;
}

export async function imageFromDataUrl(
  dataUrl: string,
  input: { id?: string; name?: string; mediaType?: SourceImage["mediaType"] } = {},
): Promise<SourceImage> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(dataUrl);
  const mediaType = (input.mediaType ?? match?.[1]) as SourceImage["mediaType"] | undefined;
  if (!mediaType || !ACCEPTED_TYPES.has(mediaType)) throw new Error("只支持 PNG、JPEG 或 WebP 图片。");
  const data = dataUrlToBase64(dataUrl);
  if (data.length > MAX_IMAGE_BASE64_CHARS) throw new Error("这张图片过大，请压缩后再添加。");
  return { id: input.id ?? newImageId(), mediaType, data, name: input.name };
}

async function compressFile(file: File) {
  const bitmap = await createImageBitmap(file);
  let maxSide = 1600;
  for (const quality of [0.86, 0.8, 0.72]) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理这张图片。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlToBase64(dataUrl).length <= MAX_IMAGE_BASE64_CHARS) {
      bitmap.close?.();
      return { dataUrl, mediaType: "image/jpeg" as const };
    }
    maxSide = 1200;
  }
  bitmap.close?.();
  throw new Error("这张图片压缩后仍然过大，请截取通知的关键部分后再试。");
}

export async function sourceImageFromFile(file: File): Promise<SourceImage> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error("只支持 PNG、JPEG 或 WebP 图片。");
  if (file.size > 12 * 1024 * 1024) throw new Error("单张图片不能超过 12 MB。");
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取图片失败，请重试。"));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrlToBase64(original);
  const originalType = file.type as SourceImage["mediaType"];
  if (base64.length <= 1_200_000 && (originalType === "image/png" || file.size <= 900_000)) {
    return { id: newImageId(), mediaType: originalType, data: base64, name: file.name };
  }
  const compressed = await compressFile(file);
  return { id: newImageId(), mediaType: compressed.mediaType, data: dataUrlToBase64(compressed.dataUrl), name: file.name };
}

export async function loadImageFromUrl(
  url: string,
  name: string,
  input: { id?: string } = {},
): Promise<SourceImage> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("演示截图加载失败，请重试。");
  const blob = await response.blob();
  if (!ACCEPTED_TYPES.has(blob.type)) throw new Error("演示截图格式不受支持。");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("读取演示截图失败。"));
    reader.readAsDataURL(blob);
  });
  return imageFromDataUrl(dataUrl, { id: input.id, name });
}

export function totalImageChars(images: SourceImage[]) {
  return images.reduce((total, image) => total + image.data.length, 0);
}

export function assertImageBudget(images: SourceImage[]) {
  if (images.length > MAX_IMAGES) throw new Error(`一次最多添加 ${MAX_IMAGES} 张截图。`);
  if (totalImageChars(images) > MAX_TOTAL_IMAGE_BASE64_CHARS) {
    throw new Error("截图总大小过大，请删掉部分图片或先压缩。");
  }
}