import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkProperties, EVENT_PROPERTIES, PRODUCT_EVENTS } from "../src/lib/analytics/events.ts";
import { actorHash, eventsEnabled, track } from "../src/lib/analytics/track.ts";

const fill = (n: number) => Array.from({ length: n }, (_, i) => "Qz7Hk2Lm9Rt4Vw8"[i % 15]).join("");

test("the event list matches the migration's CHECK exactly", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0062_product_events.sql", import.meta.url), "utf8");
  const list = sql.match(/event in \(([\s\S]*?)\)\)/)![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1));
  assert.deepEqual(list, [...PRODUCT_EVENTS]);
  assert.deepEqual(Object.keys(EVENT_PROPERTIES), [...PRODUCT_EVENTS]);
});

test("allowed properties pass, as stored", () => {
  assert.deepEqual(checkProperties("run_created", { source: "button", judge_source: "trial_free" }), { ok: true, properties: { source: "button", judge_source: "trial_free" } });
  assert.deepEqual(checkProperties("policy_saved", { version: 3 }), { ok: true, properties: { version: 3 } });
  assert.deepEqual(checkProperties("agent_probed", { ok: false }), { ok: true, properties: { ok: false } });
  assert.deepEqual(checkProperties("report_viewed"), { ok: true, properties: {} });
  assert.deepEqual(checkProperties("run_completed", { cases: 49, extra: undefined }), { ok: true, properties: { cases: 49 } });
});

test("an unknown event or an unlisted property refuses the whole event", () => {
  assert.equal(checkProperties("page_view", {}).ok, false);
  assert.equal(checkProperties("report_viewed", { token: "x" }).ok, false);
  assert.equal(checkProperties("run_created", { source: "button", workspace_id: "w" }).ok, false);
  assert.equal(checkProperties("signup_started", { method: "email", email: "a@b.eu" }).ok, false);
});

test("values outside their enum, type or range are refused", () => {
  assert.equal(checkProperties("run_created", { source: "cli" }).ok, false);
  assert.equal(checkProperties("policy_saved", { version: "3" }).ok, false);
  assert.equal(checkProperties("policy_saved", { version: 1.5 }).ok, false);
  assert.equal(checkProperties("policy_saved", { version: 0 }).ok, false);
  assert.equal(checkProperties("agent_probed", { ok: "true" }).ok, false);
  assert.equal(checkProperties("landing_cta_click", { placement: "Hero Button" }).ok, false);
  assert.equal(checkProperties("landing_cta_click", { placement: { nested: true } }).ok, false);
});

test("a slug that is a key, token, email or identifier is refused even where slugs are allowed", () => {
  for (const placement of [`sk-${fill(20).toLowerCase()}`, `nvk_${fill(10).toLowerCase()}`, `whsec_${fill(10).toLowerCase()}`, `gsk_${fill(10).toLowerCase()}`, fill(32).toLowerCase(), "7d3c0c1e-1111-4222-8333-944455556666".slice(0, 32)]) {
    const r = checkProperties("landing_cta_click", { placement });
    assert.equal(r.ok, false, placement);
  }
  assert.deepEqual(checkProperties("landing_cta_click", { placement: "hero" }), { ok: true, properties: { placement: "hero" } });
  assert.deepEqual(checkProperties("billing_checkout_started", { plan: "team-monthly" }), { ok: true, properties: { plan: "team-monthly" } });
});

test("the actor is a salted HMAC, never the id, and absent without a salt", () => {
  const env = { NOVERA_EVENTS_SALT: fill(32) };
  const h = actorHash("7d3c0c1e-1111-4222-8333-944455556666", env)!;
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("7d3c0c1e"));
  assert.equal(actorHash("7d3c0c1e-1111-4222-8333-944455556666", env), h, "stable per person");
  assert.notEqual(actorHash("7d3c0c1e-1111-4222-8333-944455556666", { NOVERA_EVENTS_SALT: fill(31) + "x" }), h, "changes with the salt");
  assert.equal(actorHash("u", {}), null);
  assert.equal(actorHash("u", { NOVERA_EVENTS_SALT: "short" }), null);
  assert.equal(actorHash(null, env), null);
});

test("events are on by default and off with NOVERA_PRODUCT_EVENTS=off", () => {
  assert.equal(eventsEnabled({}), true);
  assert.equal(eventsEnabled({ NOVERA_PRODUCT_EVENTS: "off" }), false);
});

function fakeClient(result: { error: { code: string } | null } | "throw" = { error: null }) {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      assert.equal(table, "product_events");
      return {
        insert(row: Record<string, unknown>) {
          rows.push(row);
          return { abortSignal: async () => { if (result === "throw") throw new Error("network"); return result; } };
        },
      };
    },
  };
  return { rows, client: client as never };
}

test("track stores the checked row: the workspace, a hashed actor, the properties — never the user id", async () => {
  const previous = process.env.NOVERA_EVENTS_SALT;
  process.env.NOVERA_EVENTS_SALT = fill(32);
  try {
    const { rows, client } = fakeClient();
    await track("run_created", { client, workspaceId: "ws-1", userId: "user-uuid-1", properties: { source: "api", judge_source: "workspace_key" } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, "run_created");
    assert.equal(rows[0].workspace_id, "ws-1");
    assert.match(String(rows[0].actor_hash), /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(rows[0]).includes("user-uuid-1"));
    assert.deepEqual(rows[0].properties, { source: "api", judge_source: "workspace_key" });
  } finally {
    if (previous === undefined) delete process.env.NOVERA_EVENTS_SALT; else process.env.NOVERA_EVENTS_SALT = previous;
  }
});

test("track never throws and stores nothing it refuses", async () => {
  const original = console.error;
  const logged: string[] = [];
  console.error = (line: string) => { logged.push(line); };
  try {
    const refused = fakeClient();
    await track("report_viewed", { client: refused.client, properties: { token: "abc" } });
    assert.equal(refused.rows.length, 0);
    assert.match(logged[0], /report_viewed refused/);
    await track("report_viewed", { client: fakeClient("throw").client });
    await track("report_viewed", { client: fakeClient({ error: { code: "PGRST205" } }).client });
    assert.match(logged.at(-1)!, /not stored \(PGRST205\)/);
  } finally {
    console.error = original;
  }
});
