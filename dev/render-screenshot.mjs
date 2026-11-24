import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const input = path.resolve(process.argv[2] ?? "dev/sample-screenshot.html");
const output = path.resolve(process.argv[3] ?? "public/demo/lab-safety-notice.png");
const width = Number(process.argv[4] ?? 390);
const port = 9333;
const profile = path.resolve("dev/.edge-render-profile");

await mkdir(profile, { recursive: true });
await mkdir(path.dirname(output), { recursive: true });
const child = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Edge is still starting.
    }
    await sleep(150);
  }
  throw new Error("Edge 调试端口没有就绪。");
}

try {
  const page = await findPage();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const events = new Map();
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const waitEvent = (name) => new Promise((resolve) => events.set(name, resolve));
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error.message));
      else request?.resolve(message.result);
      return;
    }
    events.get(message.method)?.(message.params);
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: pathToFileURL(input).href });
  await loaded;
  await sleep(250);
  const metrics = await send("Page.getLayoutMetrics");
  const height = Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  await writeFile(output, Buffer.from(shot.data, "base64"));
  console.log(JSON.stringify({ output, width, height }));
  socket.close();
} finally {
  child.kill();
}