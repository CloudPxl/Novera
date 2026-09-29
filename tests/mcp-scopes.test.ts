import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTools, instructionsFor } from "../src/lib/mcp/tools.ts";
import { READ_ONLY_INSTRUCTIONS } from "../src/lib/mcp/protocol.ts";

// Listing tools never touches the database, so a stand-in client is enough.
const db = {} as SupabaseClient;
const names = (scopes: Array<"read" | "run" | "write">) =>
  buildTools(db, { workspaceId: "w", keyId: "k", scopes }, "https://x").map((t) => t.name);

const READ = ["list_agents", "list_suites", "list_runs", "get_run", "get_evidence_gaps", "compare_runs", "verify_report"];

test("a key is offered only the tools its scopes allow", () => {
  assert.deepEqual(names(["read"]), READ);
  assert.deepEqual(names(["read", "run"]), [...READ, "start_run", "advance_run"]);
  assert.deepEqual(names(["read", "write"]), [...READ, "draft_scenarios", "request_diagnosis"]);
  assert.deepEqual(names(["read", "run", "write"]), [...READ, "start_run", "advance_run", "draft_scenarios", "request_diagnosis"]);
});

test("no tool at any scope approves, publishes, revokes, sends or changes a policy", () => {
  const all = buildTools(db, { workspaceId: "w", keyId: "k", scopes: ["read", "run", "write"] }, "https://x");
  for (const t of all) {
    assert.doesNotMatch(t.name, /approve|reject|publish|revoke|send|policy|delete|decide/);
    assert.equal(t.annotations?.destructiveHint ?? false, false, t.name);
  }
  // Everything beyond the read tools says it is not read-only.
  for (const t of all.filter((t) => !READ.includes(t.name))) assert.equal(t.annotations?.readOnlyHint, false, t.name);
});

test("the instructions say what this key can do, and that approving is a person's", () => {
  assert.equal(instructionsFor(["read"]), READ_ONLY_INSTRUCTIONS);
  assert.match(instructionsFor(["read", "run"]), /start_run/);
  assert.doesNotMatch(instructionsFor(["read", "run"]), /draft/);
  const write = instructionsFor(["read", "write"]);
  assert.match(write, /nothing you call can approve/);
  assert.doesNotMatch(write, /start_run/);
});

test("a malformed id is refused with where to find a real one, before anything runs", async () => {
  const tools = buildTools(db, { workspaceId: "w", keyId: "k", scopes: ["read", "run", "write"] }, "https://x");
  const draft = tools.find((t) => t.name === "draft_scenarios")!;
  await assert.rejects(() => draft.run({ agent_id: "nope" }), /list_agents/);
  const start = tools.find((t) => t.name === "start_run")!;
  await assert.rejects(() => start.run({ agent_id: "00000000-0000-0000-0000-000000000000", suite_id: "x" }), /list_suites/);
  const diag = tools.find((t) => t.name === "request_diagnosis")!;
  await assert.rejects(() => diag.run({ run_id: "bad", scenario_id: "T01" }), /list_runs/);
});
