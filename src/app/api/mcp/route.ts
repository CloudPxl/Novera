import { authenticateApiKey } from "@/lib/api/auth.ts";
import { handleMessage, SUPPORTED_VERSIONS } from "@/lib/mcp/protocol.ts";
import { buildTools } from "@/lib/mcp/tools.ts";
import { serviceClient } from "@/lib/supabase/service.ts";

export const dynamic = "force-dynamic";

/**
 * The MCP endpoint (Streamable HTTP, stateless, read-only).
 *
 * The same workspace API key as the REST API, sent as `Authorization: Bearer nvk_…`.
 * The Origin header is checked on every request, as the specification requires: a web
 * page must not be able to drive this endpoint from a visitor's browser. Clients that
 * are not browsers send no Origin, and are unaffected.
 */

const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Cross-origin requests are not accepted." } }, { status: 403, headers: HEADERS });
  }
  const version = request.headers.get("mcp-protocol-version");
  if (version && !(SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version. Supported: ${SUPPORTED_VERSIONS.join(", ")}.` } },
      { status: 400, headers: HEADERS },
    );
  }

  const auth = await authenticateApiKey(request, "read");
  if (!auth.ok) return auth.response;

  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, { status: 400, headers: HEADERS });
  }

  const tools = buildTools(serviceClient(), auth.caller.workspaceId, new URL(request.url).origin);
  const reply = await handleMessage(message, tools);
  if (reply.kind === "accepted") return new Response(null, { status: 202, headers: HEADERS });
  return Response.json(reply.body, { status: reply.kind === "invalid" ? 400 : 200, headers: HEADERS });
}

/** No server-initiated stream is offered, so GET is not allowed (the spec's 405). */
export function GET() {
  return new Response(null, { status: 405, headers: { ...HEADERS, allow: "POST" } });
}

/** There are no sessions to end. */
export function DELETE() {
  return new Response(null, { status: 405, headers: { ...HEADERS, allow: "POST" } });
}
