import { localFixtureHandler } from "./local-fixture-handler.ts";

const port = Number(Deno.env.get("PORT") ?? "8001");
const host = Deno.env.get("HOST") ?? "0.0.0.0";

Deno.serve({ hostname: host, port }, localFixtureHandler);