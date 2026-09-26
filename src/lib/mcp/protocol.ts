/**
 * A read-only MCP server, as plain JSON-RPC over the Streamable HTTP transport
 * (specification 2025-06-18): one JSON response per request, 202 for a notification, no
 * event stream, no session. Stateless on purpose — every request carries its API key, so
 * there is no session to hijack and nothing to expire.
 *
 * This module decides what a message means; the route handler owns HTTP. Tools are
 * supplied by the caller, so this file knows nothing about workspaces or the database.
 */

export const SERVER_INFO = { name: "novera", title: "Novera", version: "1.0.0" };
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const DEFAULT_VERSION = "2025-06-18";

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/** A refusal a tool raises on purpose, reported to the model as a tool error, not a crash. */
export class ToolRefusal extends Error {}

type JsonRpcId = string | number;
interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export type McpReply =
  | { kind: "response"; body: Record<string, unknown> }
  | { kind: "accepted" }
  | { kind: "invalid"; body: Record<string, unknown> };

const error = (id: JsonRpcId | null, code: number, message: string) =>
  ({ jsonrpc: "2.0", id, error: { code, message } });

function isId(v: unknown): v is JsonRpcId {
  return typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
}

export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : DEFAULT_VERSION;
}

export async function handleMessage(message: unknown, tools: Tool[]): Promise<McpReply> {
  // Batches were removed from the protocol in 2025-06-18; one message per request.
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { kind: "invalid", body: error(null, -32600, "Send one JSON-RPC message per request.") };
  }
  const m = message as JsonRpcMessage;
  if (m.jsonrpc !== "2.0" || (m.method !== undefined && typeof m.method !== "string")) {
    return { kind: "invalid", body: error(isId(m.id) ? m.id : null, -32600, "Not a JSON-RPC 2.0 message.") };
  }

  // A notification or a response from the client: accepted, nothing to answer.
  if (!isId(m.id)) return { kind: "accepted" };
  if (m.method === undefined) return { kind: "accepted" };

  const id = m.id;
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  const ok = (result: Record<string, unknown>): McpReply => ({ kind: "response", body: { jsonrpc: "2.0", id, result } });

  switch (m.method) {
    case "initialize":
      return ok({
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Novera is read-only here. Every verdict and count comes from stored runs; a scenario "
          + "with no result is never a pass. Nothing you call can start a run, change a policy, "
          + "approve anything, or publish or revoke a report.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return { kind: "response", body: error(id, -32602, `Unknown tool: ${String(params.name)}`) };
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
      try {
        const result = await tool.run(args);
        return ok({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result && typeof result === "object" && !Array.isArray(result) ? result : { result },
          isError: false,
        });
      } catch (e) {
        // A tool that refused (a bad id, another workspace's run) tells the model why, as
        // a tool result it can act on. Anything else is ours, and says only that.
        const text = e instanceof ToolRefusal ? e.message : "The tool failed on Novera's side. Try again shortly.";
        return ok({ content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return { kind: "response", body: error(id, -32601, `Method not found: ${m.method}`) };
  }
}
