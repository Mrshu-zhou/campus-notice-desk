import { createDatabaseClient } from "./_qoder/backend.mjs";
import { handleExtractionRequest, type ExtractionInput } from "./handler.ts";
import { createQcaExtractor, toPublicError } from "./qca-extraction.mjs";

const CLOUD_AGENTS_ORIGIN = "https://api.qoder.com.cn";

let extractor: ReturnType<typeof createQcaExtractor> | null = null;

function getExtractor() {
  if (!extractor) {
    extractor = createQcaExtractor({
      db: createDatabaseClient(),
      origin: CLOUD_AGENTS_ORIGIN,
    });
  }
  return extractor;
}

export function createAppHandler(service?: ReturnType<typeof createQcaExtractor>) {
  return (request: Request) => {
    const startedAt = Date.now();
    return handleExtractionRequest(request, async (input: ExtractionInput) => {
      try {
        const result = await (service ?? getExtractor()).extract(input);
        console.info(JSON.stringify({
          event: "extraction_result",
          outcome: "ok",
          mode: "cloud_agent",
          taskCount: result.tasks.length,
          imageCount: input.images.length,
          durationMs: Date.now() - startedAt,
        }));
        return Response.json(
          {
            ok: true,
            mode: "cloud_agent",
            tasks: result.tasks,
            imageReads: result.imageReads,
            ignored: result.ignored,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        const { status, body } = toPublicError(error);
        console.error(JSON.stringify({
          event: "extraction_result",
          outcome: "error",
          code: body.error,
          status,
          durationMs: Date.now() - startedAt,
        }));
        return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
      }
    });
  };
}

Deno.serve(createAppHandler());