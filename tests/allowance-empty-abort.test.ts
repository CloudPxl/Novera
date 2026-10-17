import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALLOWANCE_COLUMN, ALLOWANCE_EXCLUSION_SQL, EMPTY_ABORT_IS_FREE, countsAgainstAllowance, emptyAbortNote,
} from "../src/lib/billing/allowance.ts";

/**
 * A run aborted before it recorded any scenario uses no allowance (0074, decision 2026-10-17):
 * not the trial, not a grant's units, not a plan's managed runs. Fair use still counts it. The
 * rule lives in the database's counts under their locks and in the application's counts through
 * the computed column; these tests hold the two together and the locks where they were.
 */

const M0074 = readFileSync("supabase/migrations/0074_empty_aborted_runs_are_free.sql", "utf8");

/** The body of the last definition of `name` in a migration. */
function body(sql: string, name: string): string {
  const at = sql.lastIndexOf(`create or replace function ${name}(`);
  assert.ok(at >= 0, `${name} is defined`);
  return sql.slice(at, sql.indexOf("$$;", at) + 3);
}

/** Comments dropped, the run alias dropped, whitespace collapsed: what a body does, not how it is laid out. */
function normalise(fn: string): string {
  return fn
    .split("\n").map((l) => l.replace(/--.*$/, "")).join(" ")
    .replace(/\bfrom runs r\b/g, "from runs")
    .replace(/\br\./g, "")
    .replace(/\s+/g, " ")
    .replace(/ ;/g, ";")
    .trim();
}

const EXCLUSION = `and ${ALLOWANCE_EXCLUSION_SQL}`;
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

test("the rule: only a run aborted with no recorded scenario is free", () => {
  assert.equal(countsAgainstAllowance({ status: "aborted", recordedScenarios: 0 }), false);
  assert.equal(countsAgainstAllowance({ status: "aborted", recordedScenarios: 1 }), true, "a transport halt recorded its failures");
  assert.equal(countsAgainstAllowance({ status: "queued", recordedScenarios: 0 }), true, "a queued run holds its place");
  assert.equal(countsAgainstAllowance({ status: "running", recordedScenarios: 0 }), true);
  assert.equal(countsAgainstAllowance({ status: "completed", recordedScenarios: 0 }), true);
  assert.equal(countsAgainstAllowance({ status: "completed", recordedScenarios: 36 }), true);
});

test("the run page says so only for an aborted run with nothing recorded", () => {
  assert.equal(emptyAbortNote("aborted", 0), EMPTY_ABORT_IS_FREE);
  assert.equal(EMPTY_ABORT_IS_FREE, "This run recorded no scenario, so it does not count against your runs.");
  for (const [status, n] of [["aborted", 2], ["completed", 0], ["running", 0], ["queued", 0]] as const) {
    assert.equal(emptyAbortNote(status, n), null, `${status} with ${n}`);
  }
  const scorecard = readFileSync("src/app/(app)/runs/[id]/scorecard.tsx", "utf8");
  // Every stored row is graded, errored or never sent: their sum is the run's recorded scenarios.
  assert.match(scorecard, /emptyAbortNote\(status, coverage\.graded \+ coverage\.errored \+ coverage\.notSent\)/);
});

test("0074: the trial count excludes an empty aborted run, under the same per-owner lock", () => {
  const trial = body(M0074, "runs_trial_cap");
  assert.equal(count(trial, EXCLUSION), 1);
  assert.match(trial, /pg_advisory_xact_lock\(hashtext\('novera:trial-cap'\), hashtext\(owner::text\)\)/);
  assert.ok(trial.indexOf("pg_advisory_xact_lock") < trial.indexOf("select count(*)"), "counted after the lock");
  assert.match(trial, /used >= 3 then/);
  assert.match(trial, /trial_exhausted:/);
  // Nothing else changed from 0055's definition.
  const before = body(readFileSync("supabase/migrations/0055_trial_per_owner.sql", "utf8"), "runs_trial_cap");
  assert.equal(normalise(trial.replace(EXCLUSION, "")), normalise(before));
});

test("0074: grant and managed counts exclude it; fair use still counts every start; the lock is unchanged", () => {
  const fn = body(M0074, "runs_fair_use_and_funding");
  assert.equal(count(fn, EXCLUSION), 2, "the grant count and the managed-period count");
  const grant = fn.slice(fn.indexOf("if g.runs_allowed is not null"), fn.indexOf("grant_exhausted"));
  const managed = fn.slice(fn.indexOf("select managed_runs_per_period"), fn.indexOf("managed_allowance_exhausted"));
  assert.ok(grant.includes(EXCLUSION), "grant units");
  assert.ok(managed.includes(EXCLUSION), "managed allowance");
  const fairUse = fn.slice(fn.indexOf("select count(*) into in_flight"), fn.indexOf("fair_use_limit"));
  assert.ok(!fairUse.includes("run_cases"), "fair use counts every start");
  assert.match(fn, /pg_advisory_xact_lock\(hashtext\('novera:run-start'\), hashtext\(new\.workspace_id::text\)\)/);
  assert.ok(fn.indexOf("pg_advisory_xact_lock") < fn.indexOf("select count(*)"), "every count after the lock");
  // Nothing else changed from 0067's definition: same ceilings, same refusals, same order.
  const before = body(readFileSync("supabase/migrations/0067_run_funding_and_fair_use.sql", "utf8"), "runs_fair_use_and_funding");
  assert.equal(normalise(fn.split(EXCLUSION).join("")), normalise(before));
});

test("0074: no trigger is dropped or rebound, rows are not touched, and the computed column is the same rule", () => {
  assert.doesNotMatch(M0074, /drop trigger|create trigger/i, "the 0049/0055/0067 triggers keep firing in name order");
  assert.doesNotMatch(M0074, /^\s*(update|delete from|insert into)\s+runs\b/im, "the counting changes, never the rows");
  const column = M0074.slice(M0074.indexOf(`create or replace function ${ALLOWANCE_COLUMN}(r runs)`));
  assert.ok(column.length > 0, "the computed column is defined on runs");
  assert.match(column.slice(0, column.indexOf("$$;")), /select not \(r\.status = 'aborted' and not exists \(select 1 from run_cases c where c\.run_id = r\.id\)\)/);
  assert.doesNotMatch(column.slice(0, column.indexOf("$$;")), /security definer/, "a caller sees run_cases exactly where it sees the run");
});

test("the application counts the trial, grants and managed runs through the same column, fair use without it", () => {
  const ent = readFileSync("src/lib/auth/entitlement.ts", "utf8");
  assert.match(ent, /\.eq\(ALLOWANCE_COLUMN, true\)/, "trial");
  const rows = readFileSync("src/lib/billing/rows.ts", "utf8");
  const pager = rows.slice(rows.indexOf("async function runTimesSince"), rows.indexOf("export async function loadBillingRows"));
  assert.match(pager, /\.eq\(ALLOWANCE_COLUMN, true\)/, "grant and managed windows");
  const fairUse = rows.slice(rows.indexOf("const [stored, grants, totalRuns, runsInFlight, runsInWindow]"), rows.indexOf("const subscriptions"));
  assert.doesNotMatch(fairUse, /ALLOWANCE_COLUMN/, "fair use counts every start");
});

test("an aborted run with no recorded scenario never says every scenario passed", async () => {
  const { readFileSync } = await import("node:fs");
  const overview = readFileSync("src/app/(app)/runs/[id]/overview.tsx", "utf8");
  assert.match(overview, /recorded === 0 \? "No scenario was recorded in this run/);
  assert.match(readFileSync("src/app/(app)/runs/[id]/page.tsx", "utf8"), /recorded=\{caseRows\.length\}/);
});
