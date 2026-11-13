/**
 * 0087 in a real Postgres (PGlite, in memory): the fair claim, the per-agent cap, the waiting line
 * and the shared model pacing, exactly as the migration file defines them. The `runs` table here
 * has only the columns the functions read; everything else about runs is tested elsewhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync("supabase/migrations/0087_run_queue_and_shared_pacing.sql", "utf8");
const W = { A: "00000000-0000-0000-0000-00000000000a", B: "00000000-0000-0000-0000-00000000000b", C: "00000000-0000-0000-0000-00000000000c" };
const agent = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const run = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table runs (id uuid primary key, workspace_id uuid not null, agent_id uuid not null, status text not null,
      judge_source text, lease_until timestamptz, lease_token uuid, created_at timestamptz not null default clock_timestamp());`);
  await db.exec(SQL);
  const add = (n: number, ws: string, a: number, source = "trial_free") =>
    db.query(`insert into runs (id, workspace_id, agent_id, status, judge_source) values ($1, $2, $3, 'queued', $4)`, [run(n), ws, agent(a), source]);
  const claim = async (n: number, ws: string, slots = 2, perAgent = 2) =>
    (await db.query<{ r: { outcome: string; reason?: string; position?: number; lease_token?: string } }>(
      `select claim_run_slice_fair($1, $2, 70000, $3, $4) as r`, [run(n), ws, slots, perAgent])).rows[0].r;
  const release = (n: number) => db.query(`update runs set lease_until = null, lease_token = null where id = $1`, [run(n)]);
  const finish = (n: number) => db.query(`update runs set status = 'completed', lease_until = null where id = $1`, [run(n)]);
  return { db, add, claim, release, finish };
}

test("0087: the shared slots go round-robin across workspaces, a run between slices goes to the back, and every run finishes", async () => {
  const { add, claim, release, finish } = await database();
  // Workspace A starts three runs, B one, C one, on Novera's keys; two shared slots.
  await add(1, W.A, 1); await add(2, W.A, 2); await add(3, W.A, 3); await add(4, W.B, 4); await add(5, W.C, 5);
  assert.equal((await claim(1, W.A)).outcome, "claimed");
  assert.equal((await claim(2, W.A)).outcome, "claimed");
  const b = await claim(4, W.B);
  assert.deepEqual([b.outcome, b.reason, b.position], ["busy", "slots", 1]);
  const c = await claim(5, W.C);
  assert.deepEqual([c.outcome, c.position], ["busy", 2]);
  const a3 = await claim(3, W.A);
  assert.deepEqual([a3.outcome, a3.position], ["busy", 3], "A's third run waits behind B and C: A already holds two slices");
  assert.equal((await claim(1, W.A)).outcome, "held", "a held run is never claimed twice");

  // Drive every run to completion: each round, every unfinished run asks once, in a fixed order,
  // and every slice that started hands back. Slices are counted per run.
  const slices = new Map<number, number>();
  const order: number[] = [];
  const need = new Map([[1, 4], [2, 4], [3, 4], [4, 4], [5, 4]]);
  await release(1); await release(2);
  for (let round = 0; round < 40 && [...need.values()].some((v) => v > 0); round++) {
    const started: number[] = [];
    for (const [n, ws] of [[1, W.A], [2, W.A], [3, W.A], [4, W.B], [5, W.C]] as const) {
      if ((need.get(n) ?? 0) <= 0) continue;
      if ((await claim(n, ws)).outcome === "claimed") started.push(n);
    }
    assert.ok(started.length <= 2, "never more than two shared slices at once");
    for (const n of started) {
      order.push(n);
      slices.set(n, (slices.get(n) ?? 0) + 1);
      need.set(n, (need.get(n) ?? 0) - 1);
      if ((need.get(n) ?? 0) <= 0) await finish(n); else await release(n);
    }
  }
  assert.deepEqual([...need.values()], [0, 0, 0, 0, 0], `every run finished: ${JSON.stringify(order)}`);
  assert.deepEqual(order.slice(0, 2).sort(), [4, 5], "the next two slices go to the workspaces that held none");
  // No workspace waits more than two rounds while another takes consecutive slices.
  const firstOf = (n: number) => order.indexOf(n);
  assert.ok(firstOf(3) < 8, `A's third run is not starved: ${JSON.stringify(order)}`);
});

test("0087: at most per_agent slices test one agent, whoever funds the runs; a run on its own key needs no shared slot", async () => {
  const { add, claim } = await database();
  await add(1, W.A, 7, "workspace_key"); await add(2, W.B, 7, "workspace_key"); await add(3, W.A, 7, "plan_managed"); await add(4, W.C, 8, "workspace_key");
  assert.equal((await claim(1, W.A, 1, 2)).outcome, "claimed");
  assert.equal((await claim(2, W.B, 1, 2)).outcome, "claimed", "two runs on one agent");
  const third = await claim(3, W.A, 1, 2);
  assert.deepEqual([third.outcome, third.reason, third.position], ["busy", "agent", 1]);
  assert.equal((await claim(4, W.C, 1, 2)).outcome, "claimed", "another agent on its own key is not limited by the shared slots");
});

test("0087: a run nobody asked for in two minutes leaves the line; the dispatcher still finds it for ten", async () => {
  const { db, add, claim, release } = await database();
  await add(1, W.A, 1); await add(2, W.B, 2); await add(3, W.C, 3);
  assert.equal((await claim(1, W.A, 1)).outcome, "claimed");
  assert.equal((await claim(2, W.B, 1)).outcome, "busy");
  await db.query(`update runs set waiting_since = now() - interval '1 hour', waiting_seen_at = now() - interval '5 minutes' where id = $1`, [run(2)]);
  await release(1);
  assert.equal((await claim(3, W.C, 1)).outcome, "claimed", "B's closed tab does not hold C back");
  const head = await db.query<{ run_id: string }>(`select * from next_waiting_run()`);
  assert.equal(head.rows[0]?.run_id, run(2), "but the server still dispatches B, the longest waiting");
  await db.query(`update runs set waiting_seen_at = now() - interval '11 minutes' where id = $1`, [run(2)]);
  assert.equal((await db.query(`select * from next_waiting_run()`)).rows.length, 0, "after ten minutes nobody is dispatched");
});

test("0087: a model's next slot is shared by every caller; a slot too far away is refused and reserves nothing", async () => {
  const { db } = await database();
  const slot = async (interval: number, max: number) =>
    (await db.query<{ w: number }>(`select reserve_model_slot('groq/openai/gpt-oss-20b', $1, $2) as w`, [interval, max])).rows[0].w;
  assert.equal(await slot(1_000, 20_000), 0);
  const second = await slot(1_000, 20_000);
  assert.ok(second > 900 && second <= 1_000, String(second));
  assert.equal(await slot(1_000, 500), -1);
  const third = await slot(1_000, 20_000);
  assert.ok(third > 1_900 && third <= 2_000, `the refusal took no slot: ${third}`);
  assert.equal(await slot(0, 0), 0, "an unpaced model is never held");
  await assert.rejects(() => db.query(`select reserve_model_slot('', 1000, 1000)`));
});
