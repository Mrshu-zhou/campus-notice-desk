import type { ExtractionResult, Task } from "../types";

export function parseExtractionMode(mode: unknown): ExtractionResult["mode"] | null {
  if (mode === "cloud_agent" || mode === "online" || mode === "qwen") return "cloud_agent";
  if (mode === "local_fixture") return "local_fixture";
  if (mode === "verified_offline") return "verified_offline";
  return null;
}

export function originCaption(origin?: Task["origin"] | ExtractionResult["mode"] | null) {
  if (origin === "cloud_agent") return "Cloud Agent 在线拆解";
  if (origin === "local_fixture") return "本地核对样例，未调用 Cloud Agent";
  if (origin === "verified_offline") return "离线已核对，未调用 Cloud Agent";
  return null;
}
