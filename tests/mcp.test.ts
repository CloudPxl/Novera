import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage, negotiateVersion, ToolRefusal, DEFAULT_VERSION, type Tool } from "../src/lib/mcp/protocol.ts";

const TOOLS: Tool[] = [
  { name: "echo", title: "Echo", description: "d", inputSchema: { type: "object" }, run: async (a) => ({ got: a }) },
  { name: "refuses", title: "R", description: "d", inputSchema: { type: "object" }, run: async () => { throw new ToolRefusal("No such run in this workspace."); } },
  { name: "crashes", title: "C", description: "d", inputSchema: { type: "object" }, run: async () => { throw new Error("connection string with secrets"); } },
];

const body = async (msg: unknown) => {
  const r = await handleMessage(msg, TOOLS);
  assert.notEqual(r.kind, "accepted");
  return (r as { body: Record<string, unknown> }).body;
};

test("initialize negotiates a version it supports, and says the server is read-only", async () => {
  const res = await body({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  const result = res.result as Record<string, unknown>;
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.match(String(result.instructions), /read-only/);
  assert.equal(negotiateVersion("1999-01-01"), DEFAULT_VERSION);
});

test("a notification is accepted with nothing to answer; a batch is refused", async () => {
  assert.deepEqual(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, TOOLS), { kind: "accepted" });
  assert.equal((await handleMessage([{ jsonrpc: "2.0", id: 1, method: "ping" }], TOOLS)).kind, "invalid");
  assert.equal((await handleMessage({ id: 1, method: "ping" }, TOOLS)).kind, "invalid");
});

test("every tool is declared read-only", async () => {
  const res = await body({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (res.result as { tools: Array<{ annotations: Record<string, boolean> }> }).tools;
  assert.equal(tools.length, 3);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false));
});

test("a tool's result comes back as text and as structured content", async () => {
  const res = await body({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { x: 1 } } });
  const result = res.result as { content: Array<{ text: string }>; structuredContent: unknown; isError: boolean };
  assert.equal(result.isError, false);
  assert.deepEqual(result.structuredContent, { got: { x: 1 } });
  assert.deepEqual(JSON.parse(result.content[0].text), { got: { x: 1 } });
});

test("a refusal reaches the model; an internal failure never leaks its message", async () => {
  const refused = (await body({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "refuses" } })).result as { isError: boolean; content: Array<{ text: string }> };
  assert.equal(refused.isError, true);
  assert.equal(refused.content[0].text, "No such run in this workspace.");
  const crashed = (await body({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "crashes" } })).result as { content: Array<{ text: string }> };
  assert.doesNotMatch(crashed.content[0].text, /secrets/);
});

test("unknown tools and methods are JSON-RPC errors", async () => {
  assert.equal(((await body({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "start_run" } })).error as { code: number }).code, -32602);
  assert.equal(((await body({ jsonrpc: "2.0", id: 7, method: "resources/list" })).error as { code: number }).code, -32601);
});

test("a tool that is not read-only says so, and the instructions can be the key's own", async () => {
  const writes: Tool = {
    name: "draft", title: "D", description: "d", inputSchema: { type: "object" },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async () => ({}),
  };
  const list = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [writes]);
  const tools = ((list as unknown as { body: { result: { tools: Array<{ annotations: Record<string, boolean> }> } } }).body.result.tools);
  assert.equal(tools[0].annotations.readOnlyHint, false);
  assert.equal(tools[0].annotations.destructiveHint, false);

  const init = await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }, [writes], "custom words");
  assert.equal((init as unknown as { body: { result: { instructions: string } } }).body.result.instructions, "custom words");
});
