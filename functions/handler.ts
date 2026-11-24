const MAX_REQUEST_BYTES = 9 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64_CHARS = 3_500_000;
const MAX_TOTAL_IMAGE_BASE64_CHARS = 8_000_000;
const ROLES = ["student", "counselor"];
const SOURCE_TYPES = ["wechat_group", "dingtalk_or_wecom", "email", "paste"];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface ExtractionImage {
  id: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
}

export interface ExtractionInput {
  role: "student" | "counselor";
  today: string;
  sourceType: "wechat_group" | "dingtalk_or_wecom" | "email" | "paste";
  body: string;
  images: ExtractionImage[];
}

type ValidInputHandler = (input: ExtractionInput) => Response | Promise<Response>;

class RequestTooLargeError extends Error {}

function json(
  payload: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function errorResponse(status: number, error: string, message: string): Response {
  return json({ ok: false, error, message }, status);
}

async function readLimitedBody(request: Request): Promise<string> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RequestTooLargeError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function imageMatchesType(bytes: string, mediaType: string): boolean {
  const at = (index: number) => bytes.charCodeAt(index);
  if (mediaType === "image/png") {
    return bytes.length > 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47
      && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a;
  }
  if (mediaType === "image/jpeg") {
    return bytes.length > 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
  }
  if (mediaType === "image/webp") {
    return bytes.length > 12
      && bytes.slice(0, 4) === "RIFF"
      && bytes.slice(8, 12) === "WEBP";
  }
  return false;
}

function parseImages(value: unknown): ExtractionImage[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) return null;
  const images: ExtractionImage[] = [];
  const seen = new Set<string>();
  let totalChars = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const { id, mediaType, data } = item as Record<string, unknown>;
    if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(id) || seen.has(id)) return null;
    if (typeof mediaType !== "string" || !IMAGE_TYPES.includes(mediaType)) return null;
    if (typeof data !== "string" || data.length < 16 || data.length > MAX_IMAGE_BASE64_CHARS || !isBase64(data)) {
      return null;
    }
    totalChars += data.length;
    if (totalChars > MAX_TOTAL_IMAGE_BASE64_CHARS) return null;
    let binary: string;
    try {
      binary = atob(data);
    } catch {
      return null;
    }
    if (!imageMatchesType(binary, mediaType)) return null;
    seen.add(id);
    images.push({ id, mediaType: mediaType as ExtractionImage["mediaType"], data });
  }
  return images;
}

function parseInput(value: unknown): ExtractionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowedKeys = new Set(["role", "today", "sourceType", "body", "images"]);
  const keys = Object.keys(value);
  if (keys.length < 4 || keys.some((key) => !allowedKeys.has(key))) return null;
  const { role, today, sourceType, body, images: rawImages } = value as Record<string, unknown>;
  if (typeof role !== "string" || !ROLES.includes(role)) return null;
  if (typeof today !== "string" || !isValidDate(today)) return null;
  if (typeof sourceType !== "string" || !SOURCE_TYPES.includes(sourceType)) return null;
  if (typeof body !== "string" || body.length > MAX_TEXT_CHARS) return null;
  const images = parseImages(rawImages);
  if (!images) return null;
  if (body.trim().length < 1 && images.length === 0) return null;
  return { role, today, sourceType, body, images } as ExtractionInput;
}

export async function handleExtractionRequest(
  request: Request,
  onValidInput: ValidInputHandler,
): Promise<Response> {
  try {
    const action = new URL(request.url).searchParams.get("action");
    if (action !== "extract") {
      return errorResponse(404, "unknown_action", "未知操作。");
    }
    if (request.method !== "POST") {
      return json(
        { ok: false, error: "method_not_allowed", message: "仅支持 POST 请求。" },
        405,
        { Allow: "POST" },
      );
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return errorResponse(415, "unsupported_media_type", "请求必须使用 application/json。");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readLimitedBody(request));
    } catch (error) {
      if (error instanceof RequestTooLargeError) throw error;
      return errorResponse(400, "invalid_json", "请求体不是有效 JSON。");
    }
    const input = parseInput(parsed);
    if (!input) {
      return errorResponse(400, "invalid_input", "请检查 role、today、sourceType、body 和 images 字段。");
    }
    return await onValidInput(input);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return errorResponse(413, "request_too_large", "请求体过大。");
    }
    return errorResponse(500, "internal_error", "请求处理失败，请稍后重试。");
  }
}

export function handler(request: Request): Promise<Response> {
  return handleExtractionRequest(request, () =>
    errorResponse(
      503,
      "cloud_agent_not_enabled",
      "在线拆解尚未启用，预置通知仍可查看已核对结果。",
    ));
}
