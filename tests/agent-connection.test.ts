import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  archiveConfirmed, changedConnectionFields, MAX_TIMEOUT_SECONDS, nextHttpConfig, parseBodyTemplate,
  parseConnectionEdit, touchesConnection,
} from "../src/lib/agents/connection.ts";
import { AGENT_TIMEOUT_MAX_MS } from "../src/lib/agents/http.ts";
import type { HttpAgentConfig } from "../src/lib/agents/types.ts";

const base: HttpAgentConfig = {
  kind: "http", url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply",
  method: "POST", headers: { "x-tenant": "acme" },
};

const form = (over: Record<string, unknown> = {}) => ({
  name: "Support bot", url: "https://bot.example/chat", bodyTemplate: '{"message":"{{input}}"}', responsePath: "reply",
  toolActivityPath: "", timeoutSeconds: "", authHeaderName: "", credential: "", removeCredential: null, ...over,
});

test("a body template is a JSON object carrying {{input}}", () => {
  assert.equal(parseBodyTemplate('{"message":"{{input}}"}').ok, true);
  assert.match((parseBodyTemplate("[]") as { error: string }).error, /JSON object/);
  assert.match((parseBodyTemplate("not json") as { error: string }).error, /JSON object/);
  assert.match((parseBodyTemplate('{"message":"hello"}') as { error: string }).error, /\{\{input\}\}/);
});

test("every placeholder Novera fills is allowed, nested anywhere", () => {
  const all = '{"messages":"{{history}}","q":"{{input}}","meta":{"ctx":"{{context}}","id":"{{conversation_id}}"},"system":["{{policy}}"]}';
  assert.equal(parseBodyTemplate(all).ok, true);
});

test("a placeholder Novera does not fill is refused, by name, rather than sent as written", () => {
  const r = parseBodyTemplate('{"message":"{{message}}","q":"{{input}}"}');
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /\{\{message\}\}/);
});

test("a template the size of a file is refused", () => {
  const big = JSON.stringify({ message: "{{input}}", pad: "x".repeat(20_000) });
  assert.match((parseBodyTemplate(big) as { error: string }).error, /longer than/);
});

test("the timeout bound is the adapter's", () => {
  assert.equal(MAX_TIMEOUT_SECONDS * 1000, AGENT_TIMEOUT_MAX_MS);
  assert.equal(parseConnectionEdit(form({ timeoutSeconds: "30" }), false).ok, true);
  assert.equal(parseConnectionEdit(form({ timeoutSeconds: "31" }), false).ok, false);
  assert.equal(parseConnectionEdit(form({ timeoutSeconds: "1" }), false).ok, false);
  assert.equal(parseConnectionEdit(form({ timeoutSeconds: "2.5" }), false).ok, false);
});

test("the edit form refuses what would break a run or leak a credential", () => {
  assert.equal(parseConnectionEdit(form({ name: "" }), false).ok, false);
  assert.equal(parseConnectionEdit(form({ url: "ftp://bot.example" }), false).ok, false);
  assert.match((parseConnectionEdit(form({ url: "https://user:pw@bot.example" }), false) as { error: string }).error, /auth header/);
  assert.equal(parseConnectionEdit(form({ responsePath: "a..b" }), false).ok, false);
  assert.equal(parseConnectionEdit(form({ authHeaderName: "content-type", credential: "x" }), false).ok, false);
  assert.match((parseConnectionEdit(form({ credential: "secret" }), false) as { error: string }).error, /header/);
  assert.equal(parseConnectionEdit(form({ credential: "a\nb", authHeaderName: "authorization" }), false).ok, false);
  // A stored credential with no header name would silently stop being sent.
  assert.equal(parseConnectionEdit(form(), true).ok, false);
  assert.equal(parseConnectionEdit(form({ removeCredential: "on" }), true).ok, true);
  assert.equal(parseConnectionEdit(form({ removeCredential: "on", credential: "x", authHeaderName: "authorization" }), true).ok, false);
});

test("the next configuration keeps what the form does not show", () => {
  const parsed = parseConnectionEdit(form({ url: "https://bot2.example/chat", timeoutSeconds: "10", authHeaderName: "authorization", credential: "s" }), false);
  assert.equal(parsed.ok, true);
  const next = nextHttpConfig(base, (parsed as { value: Parameters<typeof nextHttpConfig>[1] }).value);
  assert.equal(next.method, "POST");
  assert.deepEqual(next.headers, { "x-tenant": "acme" });
  assert.equal(next.url, "https://bot2.example/chat");
  assert.equal(next.timeoutMs, 10_000);
  assert.equal(next.authHeaderName, "authorization");
  // The credential itself never enters the configuration.
  assert.equal(JSON.stringify(next).includes('"s"'), false);
});

test("the audit detail names changed fields and never a value", () => {
  const secret = "Bearer sk-live-very-secret";
  const parsed = parseConnectionEdit(form({
    name: "Renamed", url: "https://private-host.example/v2", bodyTemplate: '{"q":"{{input}}","p":"{{policy}}"}',
    toolActivityPath: "tool_calls", timeoutSeconds: "12", authHeaderName: "authorization", credential: secret,
  }), false);
  assert.equal(parsed.ok, true);
  const edit = (parsed as { value: Parameters<typeof nextHttpConfig>[1] }).value;
  const fields = changedConnectionFields({ name: "Support bot", config: base }, { name: edit.name, config: nextHttpConfig(base, edit) }, edit.credential);
  assert.deepEqual(fields, ["name", "url", "bodyTemplate", "toolActivityPath", "timeout", "authHeaderName", "credential"]);
  const detail = JSON.stringify({ agent: "id", fields });
  for (const value of [secret, "private-host", "Renamed", "{{policy}}", "tool_calls", "12"]) {
    assert.equal(detail.includes(value), false, value);
  }
});

test("nothing changed is nothing changed, whatever the key order of the template", () => {
  const parsed = parseConnectionEdit(form({ name: "Support bot" }), false);
  const edit = (parsed as { value: Parameters<typeof nextHttpConfig>[1] }).value;
  assert.deepEqual(changedConnectionFields({ name: "Support bot", config: base }, { name: edit.name, config: nextHttpConfig(base, edit) }, edit.credential), []);
  const reordered = { ...base, bodyTemplate: { a: 1, message: "{{input}}" } };
  const same = { ...base, bodyTemplate: { message: "{{input}}", a: 1 } };
  assert.deepEqual(changedConnectionFields({ name: "x", config: reordered }, { name: "x", config: same }, "keep"), []);
});

test("a rename alone does not touch the connection; anything else does", () => {
  assert.equal(touchesConnection(["name"]), false);
  assert.equal(touchesConnection(["name", "credential"]), true);
  assert.equal(touchesConnection(["url"]), true);
});

test("archiving needs the agent's name, exactly", () => {
  assert.equal(archiveConfirmed("Support bot", "Support bot"), true);
  assert.equal(archiveConfirmed("Support bot", "  Support bot "), true);
  assert.equal(archiveConfirmed("Support bot", "support bot"), false);
  assert.equal(archiveConfirmed("Support bot", ""), false);
  assert.equal(archiveConfirmed("Support bot", null), false);
});

test("connecting and editing check a template with the same function", () => {
  const actions = readFileSync("src/lib/workflow/actions.ts", "utf8");
  assert.match(actions, /parseBodyTemplate\(bodyTemplateRaw \|\| DEFAULT_BODY_TEMPLATE\)/);
});

test("0063 holds archive rules in the database and gives clients no write", () => {
  const sql = readFileSync("supabase/migrations/0063_agent_archive.sql", "utf8");
  assert.match(sql, /revoke insert, update, delete on agents from anon, authenticated/);
  assert.match(sql, /create trigger runs_agent_not_archived before insert on runs/);
  assert.match(sql, /create trigger run_schedules_agent_not_archived before insert or update on run_schedules/);
  assert.match(sql, /create trigger agents_archive_guard before update or delete on agents/);
  assert.match(sql, /if erasing_workspace\(\) then/);
  assert.doesNotMatch(sql, /create or replace function erase_workspace/);
});

test("startRun refuses an archived agent with a sentence, at the one entry point", () => {
  const src = readFileSync("src/lib/workflow/start-run.ts", "utf8");
  assert.match(src, /if \(agent\.archived_at\) throw new RunRefusal\(ARCHIVED_AGENT\)/);
  assert.match(src, /agent_archived/);
});
