import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { addDemoScreenshot, DEMO_SCREENSHOT_ID, DEMO_SCREENSHOT_NAME, isDemoScreenshot } from "../src/lib/images.ts";
import {
  extractionRequestBytes,
  MAX_IMAGE_BASE64_CHARS,
  MAX_REQUEST_BYTES,
  MAX_TEXT_CHARS,
  MAX_TOTAL_IMAGE_BASE64_CHARS,
  preflightExtractionBudget,
} from "../src/lib/request-budget.ts";

const demoImage = {
  id: DEMO_SCREENSHOT_ID,
  mediaType: "image/png",
  data: readFileSync(new URL("../public/demo/lab-safety-notice.png", import.meta.url)).toString("base64"),
};

test("the built-in demo screenshot fits the real handler budget", () => {
  assert.equal(preflightExtractionBudget({ body: "", images: [demoImage] }), null);
  const bytes = extractionRequestBytes({
    role: "student",
    today: "2026-11-22",
    sourceType: "wechat_group",
    body: "",
    images: [demoImage],
  });
  assert.ok(bytes > demoImage.data.length);
  assert.ok(bytes < MAX_REQUEST_BYTES);
});

test("text over 12000 characters gets an actionable Chinese message", () => {
  const message = preflightExtractionBudget({ body: "字".repeat(MAX_TEXT_CHARS + 1), images: [] });
  assert.match(message, /12000 字/);
  assert.match(message, /删减/);
});

test("too many screenshots are explained before the request leaves the browser", () => {
  const images = Array.from({ length: 5 }, (_, index) => ({ ...demoImage, id: `img-${index}` }));
  const message = preflightExtractionBudget({ body: "", images });
  assert.match(message, /最多整理 4 张截图/);
  assert.match(message, /删掉多出的图片/);
});

test("a single oversized screenshot points to compression or cropping", () => {
  const images = [{ ...demoImage, data: "A".repeat(MAX_IMAGE_BASE64_CHARS + 1) }];
  const message = preflightExtractionBudget({ body: "", images });
  assert.match(message, /单张体积上限/);
  assert.match(message, /压缩/);
});

test("total screenshot volume explains deleting, compressing or pasting text", () => {
  const images = Array.from({ length: 3 }, (_, index) => ({
    ...demoImage,
    id: `img-${index}`,
    data: "A".repeat(3_000_000),
  }));
  assert.ok(images[0].data.length <= MAX_IMAGE_BASE64_CHARS);
  assert.ok(images.reduce((total, image) => total + image.data.length, 0) > MAX_TOTAL_IMAGE_BASE64_CHARS);
  const message = preflightExtractionBudget({ body: "", images });
  assert.match(message, /截图总大小超过上限/);
  assert.match(message, /删掉部分图片/);
  assert.match(message, /压缩/);
});

test("reloading the demo screenshot is idempotent for the guided tour", () => {
  const once = addDemoScreenshot([], demoImage);
  assert.deepEqual(once, [demoImage]);
  const twice = addDemoScreenshot(once, { ...demoImage, id: "other-id", name: "另一张.png" });
  assert.equal(twice.length, 1);
  assert.equal(twice[0].id, DEMO_SCREENSHOT_ID);
  assert.equal(isDemoScreenshot({ id: "random", name: DEMO_SCREENSHOT_NAME }), true);
  assert.equal(isDemoScreenshot({ id: "random", name: "课堂通知.png" }), false);
  assert.equal(MAX_TOTAL_IMAGE_BASE64_CHARS < MAX_REQUEST_BYTES, true);
});