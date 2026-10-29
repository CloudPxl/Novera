import { API_BODY_LIMIT } from "../api/body.ts";
import { BodyTooLarge, readTextLimited } from "../net/read-body.ts";

/**
 * Reading an MCP request: the same 64 KB the REST API reads, in the shape an MCP client reads
 * (final audit D-11, 2026-10-28). `request.json()` parsed whatever was sent — a 3 MB `tools/list`
 * answered 200 — where every `/api/v1` write route refuses past its limit before parsing. The
 * refusals are JSON-RPC errors with no id (the body was not read, so none is known), because a
 * client reads `error.message`, not the REST `code`.
 */
const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

export type McpBody = { ok: true; message: unknown } | { ok: false; response: Response };

export async function readMcpBody(request: Request, limit = API_BODY_LIMIT): Promise<McpBody> {
  try {
    return { ok: true, message: JSON.parse(await readTextLimited(request as unknown as Response, limit)) };
  } catch (e) {
    if (e instanceof BodyTooLarge) {
      return {
        ok: false,
        response: Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32600, message: `The request body is larger than ${Math.round(limit / 1024)} KB, so it was not read.` } },
          { status: 413, headers: HEADERS },
        ),
      };
    }
    return { ok: false, response: Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, { status: 400, headers: HEADERS }) };
  }
}
