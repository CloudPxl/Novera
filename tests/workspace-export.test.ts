import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWorkspaceExport, serializeExport, NOT_INCLUDED, WORKSPACE_EXPORT_FORMAT, type ExportSource } from "../src/lib/export/workspace.ts";

// Every value a leak would look like. None may appear anywhere in the file.
const SECRETS = {
  reportToken: "Lk2NKiZKGZiC3xVKfYWgJj1Onva0dDql",
  keyHash: "a".repeat(64),
  keyPrefix: "nvk_live_abcd",
  inviteTokenHash: "b".repeat(64),
  inviteEmail: "not-yet-a-member@example.com",
  webhookSecretCiphertext: "c2VjcmV0LWNpcGhlcnRleHQ=",
  webhookSecretPrefix: "whsec_abcd",
  agentAuthHeader: "Bearer sk-agent-SECRET-123",
  bodyTemplateKey: "tmpl-SECRET-456",
  leaseToken: "11111111-2222-3333-4444-555555555555",
  judgeCiphertext: "judge-ciphertext-SECRET",
  verificationCredential: "readback-SECRET-789",
  rawReply: "Your card 4111 1111 1111 1111 was refunded, jane@customer.example",
  deliveryBody: "http://localhost:3100/report/Lk2NKiZKGZiC3xVKfYWgJj1Onva0dDql",
  probeBody: "probe-response-SECRET",
};

const WS = "00000000-0000-0000-0000-0000000000aa";

function fixture(): ExportSource {
  return {
    workspace: { id: WS, name: "Acme", plan: "trial", owner_id: "u-owner", created_at: "2026-10-01T00:00:00Z", raw_evidence_days: 180, secret_column: SECRETS.judgeCiphertext },
    members: [
      { user_id: "u-owner", role: "owner", created_at: "2026-10-01T00:00:00Z", email: "owner@acme.example" },
      { user_id: "u-gone", role: "auditor", created_at: "2026-10-02T00:00:00Z", email: "deleted-u-gone@deleted.invalid" },
    ],
    invitations: [{ id: "inv1", role: "reviewer", email: SECRETS.inviteEmail, token_hash: SECRETS.inviteTokenHash, invited_by: "u-owner", created_at: "2026-10-03T00:00:00Z" }],
    agents: [
      {
        id: "ag1", name: "Support bot", kind: "http", is_production: true, attested_by: "u-owner", attested_at: "2026-10-01T00:00:00Z",
        attestation_text: "I own this agent.", created_at: "2026-10-01T00:00:00Z",
        config: { kind: "http", url: "https://bot.acme.example/chat", headers: { authorization: SECRETS.agentAuthHeader }, bodyTemplate: { key: SECRETS.bodyTemplateKey, message: "{{input}}" }, responsePath: "reply" },
        verification: { kind: "http_read", url: "https://api.acme.example/orders/", credential: SECRETS.verificationCredential },
      },
      { id: "ag2", name: "Model bot", kind: "model", is_production: false, config: { kind: "model", provider: "anthropic", model: "claude-x", systemPrompt: "x", apiKey: SECRETS.judgeCiphertext } },
    ],
    policies: [{ id: "p1", agent_id: "ag1", version: 1, body: "Refunds need approval.", created_by: "u-owner", created_at: "2026-10-01T00:00:00Z" }],
    suites: [{ id: "s1", key: "acme", version: 1, name: "Acme", cases: [{ id: "A1" }], approval: "approved" }],
    runs: [{ id: "r1", agent_id: "ag1", status: "completed", manifest_hash: "d".repeat(64), lease_token: SECRETS.leaseToken, lease_until: "2026-10-04T00:00:00Z" }],
    run_cases: [
      {
        id: "c1", run_id: "r1", case_id: "T01", status: "fail", rationale: "The agent told jane@customer.example her refund was done.",
        error: null, judge_votes: [{ model: "m1", rationale: "mentions jane@customer.example" }], input: "Refund my order",
        response_text: SECRETS.rawReply, transcript: [{ role: "agent", text: SECRETS.rawReply }], tool_activity: [], raw_sha256: "e".repeat(64), raw_expired_at: null,
        judge_attempts: [{ provider: "groq", error: "429" }],
      },
      { id: "c2", run_id: "r1", case_id: "T02", status: "error", rationale: null, error: "timeout", response_text: null, raw_sha256: "f".repeat(64), raw_expired_at: "2026-10-05T00:00:00Z" },
    ],
    case_retests: [{ id: "rt1", run_case_id: "c1", status: "pass", response_text: SECRETS.rawReply, raw_expired_at: null }],
    verdict_reviews: [], diagnoses: [], evidence_observations: [],
    reports: [{ id: "rep1", run_id: "r1", token: SECRETS.reportToken, content_hash: "9".repeat(64), payload: { run: { id: "r1" }, coverage: { execution: 1 } }, created_at: "2026-10-04T00:00:00Z", expires_at: null, revoked_at: null }],
    scenario_drafts: [{ id: "d1", status: "draft", scenario: { id: "X1" } }],
    production_failures: [{ id: "pf1", customer_message: "[EMAIL_1] asked", redaction: { original_sha256: "1".repeat(64) } }],
    run_schedules: [{ id: "sch1", cadence: "weekly", lease_token: SECRETS.leaseToken }],
    webhook_endpoints: [{ id: "wh1", url: "https://hooks.acme.example/novera", events: ["run.completed"], secret_prefix: SECRETS.webhookSecretPrefix, secret_ciphertext: SECRETS.webhookSecretCiphertext, secret_iv: "iv", secret_tag: "tag" }],
    webhook_deliveries: [{ id: "del1", endpoint_id: "wh1", event: "run.completed", status: "delivered", body: { report: { url: SECRETS.deliveryBody } }, lease_token: SECRETS.leaseToken }],
    api_keys: [{ id: "k1", name: "CI", prefix: SECRETS.keyPrefix, key_hash: SECRETS.keyHash, scopes: ["read"], created_at: "2026-10-01T00:00:00Z" }],
    raw_evidence_reads: [],
    audit_events: [{ id: "ae1", actor_id: "u-owner", action: "apikey.created", detail: { key: "k1" }, created_at: "2026-10-01T00:00:00Z" }],
    suite_builds: [], suite_sources: [], suite_obligations: [],
  };
}

const META = { exportId: "ex1", exportedAt: "2026-10-09T00:00:00Z", exportedBy: "u-owner", includeRawEvidence: false };

test("no secret, token, hash of a credential or invitation address leaves in an export, raw or not", () => {
  for (const includeRawEvidence of [false, true]) {
    const file = serializeExport(buildWorkspaceExport(fixture(), { ...META, includeRawEvidence }));
    for (const [name, value] of Object.entries(SECRETS)) {
      if (includeRawEvidence && name === "rawReply") continue; // asked for, and labelled (next test)
      assert.equal(file.includes(value), false, `${name} leaked (raw=${includeRawEvidence})`);
    }
    for (const key of ["token", "key_hash", "token_hash", "prefix", "secret_prefix", "secret_ciphertext", "secret_iv", "secret_tag", "lease_token", "lease_until", "headers", "bodyTemplate", "judge_attempts", "secret_column", "config", "verification"]) {
      assert.equal(new RegExp(`"${key}"\\s*:`).test(file), false, `field ${key} present (raw=${includeRawEvidence})`);
    }
  }
});

test("raw evidence is absent unless asked for; then present only while retention holds it, and labelled", () => {
  const plain = buildWorkspaceExport(fixture(), META);
  const cases = plain.run_cases as Array<Record<string, unknown>>;
  assert.equal("raw_evidence" in cases[0], false);
  assert.equal(JSON.stringify(plain).includes("Refund my order"), false, "scenario input is raw evidence");
  // A grader's quote of personal data becomes a placeholder, as in a sealed report.
  assert.equal(JSON.stringify(plain).includes("jane@customer.example"), false);
  assert.match(String(cases[0].rationale), /\[EMAIL_1\]/);
  assert.equal(cases[0].raw_sha256, "e".repeat(64));

  const raw = buildWorkspaceExport(fixture(), { ...META, includeRawEvidence: true });
  const rawCases = raw.run_cases as Array<Record<string, Record<string, unknown>>>;
  assert.equal(rawCases[0].raw_evidence.response_text, SECRETS.rawReply);
  assert.match(String(rawCases[0].raw_evidence.label), /^RAW EVIDENCE/);
  assert.equal(rawCases[1].raw_evidence.expired, true);
  assert.equal("response_text" in rawCases[1].raw_evidence, false);
  assert.equal(raw.includes_raw_evidence, true);
  assert.match(String(rawCases[0].rationale), /jane@customer\.example/, "as stored when raw evidence was asked for");
});

test("the document is versioned, counted from its rows, and says what it leaves out", () => {
  const doc = buildWorkspaceExport(fixture(), META);
  assert.equal(doc.format, WORKSPACE_EXPORT_FORMAT);
  assert.equal(doc.format, "novera.workspace-export.v1");
  assert.equal(doc.counts.run_cases, 2);
  assert.equal(doc.counts.agents, 2);
  assert.deepEqual(doc.workspace, { id: WS, name: "Acme", plan: "trial", owner_id: "u-owner", created_at: "2026-10-01T00:00:00Z", retention: { raw_evidence_days: 180 } });
  for (const [table, n] of Object.entries(doc.counts)) assert.equal((doc[table] as unknown[]).length, n, table);
  const whats = NOT_INCLUDED.map((n) => n.what).join("\n");
  for (const must of [/API key values/, /Report link tokens/, /webhook signing secrets/i, /past the workspace's retention/, /other workspace/i, /Invitation addresses/]) {
    assert.match(whats, must);
  }
  assert.deepEqual(doc.not_included, NOT_INCLUDED);
  // A member whose account was deleted is an id, never the pseudonym address.
  const members = doc.members as Array<Record<string, unknown>>;
  assert.equal(members[0].email, "owner@acme.example");
  assert.equal(members[1].email, null);
  // An agent is its host and attestation; a read-back is its kind and host.
  const agents = doc.agents as Array<Record<string, unknown>>;
  assert.deepEqual(agents[0].endpoint, { kind: "http", host: "bot.acme.example" });
  assert.deepEqual(agents[0].read_back, { kind: "http_read", host: "api.acme.example" });
  assert.deepEqual(agents[1].endpoint, { kind: "model", provider: "anthropic", model: "claude-x" });
  // A sealed report's payload is exactly as stored, so its hash still verifies.
  assert.deepEqual((doc.reports as Array<Record<string, unknown>>)[0].payload, fixture().reports[0].payload);
});

test("the loader never selects a secret column and never reads the secrets table", () => {
  const src = readFileSync("src/lib/export/load.ts", "utf8");
  const selects = [...src.matchAll(/all\(db, "([a-z_]+)", `?"?([^"`]+)/g)].map((m) => ({ table: m[1], columns: m[2] }));
  assert.ok(selects.length >= 23, `found ${selects.length} table reads`);
  for (const { table, columns } of selects) {
    assert.notEqual(table, "secrets");
    assert.doesNotMatch(columns, /\b(token|key_hash|token_hash|prefix|secret_\w+|lease_\w+|ciphertext|judge_attempts|response_body|request)\b/, table);
  }
  assert.doesNotMatch(src, /from\("secrets"\)/);
  // Every table read is scoped to the workspace.
  assert.match(src, /\.eq\("workspace_id", workspaceId\)/);
});

test("the download route is gated by the export permission, one-time, and never cached or indexed", () => {
  const route = readFileSync("src/app/api/workspace-export/[id]/route.ts", "utf8");
  assert.match(route, /gate\(user\.id, workspace\.id, "workspace\.export"\)/);
  assert.match(route, /\.eq\("workspace_id", workspace\.id\)/);
  assert.match(route, /\.eq\("status", "pending"\)/);
  assert.match(route, /no-store/);
  assert.match(route, /noindex/);
  assert.match(route, /content-disposition/);
  assert.match(route, /"workspace\.exported"/);
  const sql = readFileSync("supabase/migrations/0061_workspace_exports.sql", "utf8");
  assert.match(sql, /has_workspace_role\(workspace_id, array\['owner', 'admin'\]\)/);
  assert.match(sql, /revoke insert, update, delete, truncate on workspace_exports from anon, authenticated/);
  assert.match(sql, /delete from workspace_exports\s+where workspace_id = target;/);
  assert.match(sql, /interval '24 hours'/);
});
