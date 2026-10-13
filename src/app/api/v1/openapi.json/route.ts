import { buildOpenApi } from "../../../../lib/api/openapi.ts";

export const dynamic = "force-static";

/** The public OpenAPI description of /api/v1. No key, no workspace data. */
export function GET() {
  return new Response(JSON.stringify(buildOpenApi(), null, 2), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
}
