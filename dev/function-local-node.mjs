import { createServer } from "node:http";
import { localFixtureHandler } from "./local-fixture-handler.ts";

const port = Number(process.env.PORT ?? 8001);
const host = process.env.HOST ?? "0.0.0.0";

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks);
    const request = new Request(`http://${req.headers.host ?? `${host}:${port}`}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body,
    });
    const response = await localFixtureHandler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "internal_error", message: "本地函数处理失败。" }));
  }
});

server.listen(port, host, () => {
  console.log(`本地拆解样例函数：http://127.0.0.1:${port}/functions/v1/app?action=extract`);
  console.log("只返回 local_fixture 已核对样例；8000 上的其他项目不受影响。");
});