import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  fundingDetail, fundingLine, grantRunsUsed, ifKeyRemoved, resolveEntitlement, sharedAcross,
  type EntitlementInput, type GrantRow,
} from "../src/lib/billing/entitlement.ts";
import { ALLOWANCE_EXCLUSION_SQL } from "../src/lib/billing/allowance.ts";
import {
  PILOT_MESSAGES, pilotGrantLine, pilotOutcomeMessage, readPilotOutcome,
} from "../src/lib/billing/pilot-codes.ts";
import { modelWorkFunding } from "../src/lib/providers/model-work.ts";
import { GRANT_FUNDED, OWNER_GRANT_FUNDED, gradingFundedBy } from "../src/lib/report/build.ts";
import { buildReceipt } from "../src/lib/report/public-verify.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { refusalFromInsert } from "../src/lib/workflow/start-run.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { DAY, T0 } from "./billing-fakes.ts";

/**
 * An owner-wide pilot (0076): a pilot redeemed from a code is one pool of runs for every workspace
 * its owner owns, like the trial — so an agency that redeems in its own workspace and then adds a
 * workspace per client can run in each of them. Held here: the migration (scope, funding check,
 * counting by grant id, lock order, one pilot per owner, ownership fixed, model work), the pure
 * entitlement across workspaces, and every sentence that names the pool.
 */

const M0076 = readFileSync("supabase/migrations/0076_owner_wide_pilot_grants.sql", "utf8");
const M0074 = readFileSync("supabase/migrations/0074_empty_aborted_runs_are_free.sql", "utf8");
const M0060 = readFileSync("supabase/migrations/0060_billing.sql", "utf8");
const EXCLUSION = `and ${ALLOWANCE_EXCLUSION_SQL}`;
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** The body of the last definition of `name` in a migration. */
function body(sql: string, name: string): string {
  const at = sql.lastIndexOf(`create or replace function ${name}(`);
  assert.ok(at >= 0, `${name} is defined`);
  return sql.slice(at, sql.indexOf("$$;", at) + 3);
}
const flat = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join(" ").replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ the migration

test("0076: a grant's scope is owner_id — only the holding workspace's owner, checked at insert, frozen", () => {
  assert.match(M0076, /alter table billing_entitlement_grants add column if not exists owner_id uuid;/);
  assert.doesNotMatch(M0076, /owner_id uuid not null/, "null keeps every existing grant's meaning: this workspace only");
  const scope = body(M0076, "billing_grants_owner_scope");
  assert.match(flat(scope), /new\.owner_id is not null and new\.owner_id is distinct from \(select owner_id from workspaces where id = new\.workspace_id\)/);
  assert.match(M0076, /create trigger billing_grants_owner_scope before insert on billing_entitlement_grants/);

  // 0060's guard, word for word, plus the scope among the frozen terms.
  const before = flat(body(M0060, "billing_grants_forward_only"));
  const after = flat(body(M0076, "billing_grants_forward_only"));
  assert.ok(after.includes("or new.owner_id is distinct from old.owner_id then"));
  assert.equal(after.replace(" or new.owner_id is distinct from old.owner_id", ""), before);

  // Ownership cannot move, so the scope cannot move under a grant.
  assert.match(flat(body(M0076, "workspaces_owner_fixed")), /if new\.owner_id is distinct from old\.owner_id then raise exception/);
  assert.match(M0076, /create trigger workspaces_owner_fixed before update of owner_id on workspaces/);
});

test("0076: the funding check accepts an owner-wide grant only in a workspace of the owner it names", () => {
  const fn = flat(body(M0076, "runs_fair_use_and_funding"));
  assert.match(fn, /grant_found := found; select owner_id into ws_owner from workspaces where id = new\.workspace_id;/,
    "FOUND is captured before the next select resets it");
  assert.match(fn, /in_scope := coalesce\(grant_found and \(g\.workspace_id = new\.workspace_id or g\.owner_id = ws_owner\), false\);/,
    "a null owner_id never matches, and a null anywhere refuses rather than passes");
  assert.match(fn, /if not in_scope or g\.revoked_at is not null or g\.starts_at > now\(\) or \(g\.ends_at is not null and g\.ends_at <= now\(\)\) then raise exception 'run_not_funded:/);
});

test("0076: an owner-wide grant is counted by grant id across workspaces, empty aborts free, after the pool lock", () => {
  const fn = body(M0076, "runs_fair_use_and_funding");
  const pool = fn.slice(fn.indexOf("perform pg_advisory_xact_lock(hashtext('novera:owner-pool')"), fn.indexOf("across the owner''s workspaces and"));
  assert.ok(pool.length > 0, "the pool branch exists");
  assert.match(pool, /pg_advisory_xact_lock\(hashtext\('novera:owner-pool'\), hashtext\(g\.owner_id::text\)\)/);
  assert.match(pool, /where r\.funded_by_grant = g\.id/);
  assert.ok(pool.includes(EXCLUSION), "0074's rule: a run aborted before any scenario is free");
  assert.ok(!/r\.workspace_id = new\.workspace_id/.test(pool), "every workspace of the owner, not this one");
  assert.ok(pool.indexOf("pg_advisory_xact_lock") < pool.indexOf("select count(*)"), "counted after the lock");

  // A one-workspace grant is counted exactly as 0074 counted it.
  const single = (src: string) => {
    const at = src.search(/select count\(\*\) into used from runs r\s+where r\.workspace_id = new\.workspace_id/);
    assert.ok(at >= 0);
    return flat(src.slice(at, src.indexOf("grant_exhausted", at)));
  };
  assert.equal(single(fn), single(body(M0074, "runs_fair_use_and_funding")));
  assert.equal(count(fn, EXCLUSION), 3, "the one-workspace grant, the pool and the managed period");
  const fairUse = fn.slice(fn.indexOf("select count(*) into in_flight"), fn.indexOf("fair_use_limit"));
  assert.ok(!fairUse.includes("run_cases"), "fair use still counts every start");
});

test("0076: one global lock order — workspace, then the owner's pool, then the trial — and no other", () => {
  const fn = body(M0076, "runs_fair_use_and_funding");
  const workspaceLock = fn.indexOf("pg_advisory_xact_lock(hashtext('novera:run-start'), hashtext(new.workspace_id::text))");
  const poolLock = fn.indexOf("pg_advisory_xact_lock(hashtext('novera:owner-pool')");
  assert.ok(workspaceLock >= 0 && poolLock > workspaceLock, "the workspace lock first, the pool lock after it");
  assert.equal(count(fn, "pg_advisory_xact_lock"), 2);
  assert.ok(!fn.includes("novera:trial-cap"), "the trial lock stays in runs_trial_cap, fired after this trigger in name order");
  assert.ok("runs_fair_use_and_funding" < "runs_trial_cap", "Postgres fires before-insert triggers in name order");
  assert.doesNotMatch(M0076, /create or replace function runs_trial_cap/, "the trial's own lock and count are unchanged (0074)");
  assert.doesNotMatch(M0076, /drop trigger if exists runs_fair_use_and_funding|create trigger runs_/, "the triggers keep their 0067/0055 bindings");
  // Redemption takes its own per-owner key, never a run-start lock.
  for (const name of ["redeem_pilot_code", "billing_pilot_redemptions_one_per_owner"]) {
    const f = body(M0076, name);
    assert.match(f, /pg_advisory_xact_lock\(hashtext\('novera:pilot-redeem'\), hashtext\(owner::text\)\)/, name);
    assert.ok(!/novera:(run-start|owner-pool|trial-cap)/.test(f), name);
  }
  assert.match(M0076, /create index if not exists runs_funded_by_grant on runs \(funded_by_grant\) where funded_by_grant is not null;/);
});

test("0076: one pilot per owner — checked under the owner's lock before the code is looked at, and by the table", () => {
  const fn = body(M0076, "redeem_pilot_code");
  const lock = fn.indexOf("novera:pilot-redeem");
  const has = fn.indexOf("'owner_has_pilot'");
  assert.ok(lock > 0 && has > lock && has < fn.indexOf("for update"), "the owner's lock, then the check, then the code's row");
  assert.match(fn, /join workspaces w on w\.id = r\.workspace_id\s+where w\.owner_id = owner/);
  assert.doesNotMatch(fn, /'workspace_has_pilot'/, "0075's per-workspace outcome is no longer answered");
  assert.match(fn, /insert into billing_entitlement_grants \(workspace_id, owner_id, kind, runs_allowed, ends_at, reason, granted_by\)\s+values \(p_workspace, owner, 'pilot'/);
  assert.match(fn, /exception when unique_violation then[\s\S]*'owner_has_pilot'/);
  assert.match(fn, /role in \('owner', 'admin'\)/);
  assert.doesNotMatch(fn, /c\.label/, "the internal label still never reaches a grant or a trail");

  const table = body(M0076, "billing_pilot_redemptions_one_per_owner");
  assert.match(table, /raise exception 'owner_has_pilot:[^;]*using errcode = '23505'/, "a unique_violation, so the redeem block is undone");
  assert.match(M0076, /create trigger billing_pilot_redemptions_one_per_owner before insert on billing_pilot_code_redemptions/);
  // 0075's per-workspace unique index stays: implied by one per owner, and what the race handler catches.
  assert.doesNotMatch(M0076, /drop constraint[^;]*billing_pilot_code_redemptions|drop index/);
  assert.match(M0076, /revoke all on function redeem_pilot_code\(text, uuid, uuid\) from public, anon, authenticated;/);
});

test("0076: model work gains plan_managed, existing rows untouched; no table, so erasure is unchanged", () => {
  assert.match(M0076, /check \(funded_by in \('trial_free', 'workspace_key', 'plan_managed'\)\)/);
  assert.doesNotMatch(M0076, /^\s*(update|delete from)\s+(model_operations|runs|billing_entitlement_grants)\b/im, "no row is rewritten");
  assert.doesNotMatch(M0076, /create table/i);
  assert.doesNotMatch(M0076, /create or replace function erase_workspace/);
  // The latest erase_workspace still deletes the grants a workspace holds — owner_id leaves with them.
  const latest = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).filter((s) => s.includes("create or replace function erase_workspace")).at(-1)!;
  assert.match(body(latest, "erase_workspace"), /delete from billing_entitlement_grants\s+where workspace_id = target;/);
});

// ------------------------------------------------------------------ the entitlement, across workspaces

const iso = (unix: number) => new Date(unix * 1000).toISOString();
const NOW = T0 + 3 * DAY;
const POOL: GrantRow = {
  id: "g-pool", kind: "pilot", planKey: null, runsAllowed: 50, startsAt: iso(T0), endsAt: iso(T0 + 30 * DAY), revokedAt: null,
  ownerId: "owner-1", poolRunsUsed: 3,
};
const NO_KEY = { connected: false, routable: false, provider: null };
/** A client workspace of the same owner: its own runs are none, the pool's are elsewhere. */
const CLIENT: EntitlementInput = {
  now: new Date(NOW * 1000), graceDays: 7, trialRunsUsed: 3, trialLimit: 3,
  byok: NO_KEY, byokRequiresPlan: true, subscriptions: [], grants: [POOL], runTimes: [], totalRuns: 0,
};

test("a client workspace runs under the owner's pool, names that grant, and counts the pool, not its own runs", () => {
  const e = resolveEntitlement(CLIENT);
  assert.deepEqual([e.source, e.canRun, e.judgeSource, e.runsUsed, e.runsAllowed], ["manual_grant", true, "plan_managed", 3, 50]);
  assert.deepEqual(e.funding, { subscriptionId: null, grantId: "g-pool" });
  assert.deepEqual(e.grant, { kind: "pilot", endsAt: POOL.endsAt, shared: true });
  // Runs in this workspace's window do not move an owner-wide count: the database counted by grant id.
  const busy = resolveEntitlement({ ...CLIENT, runTimes: Array.from({ length: 40 }, (_, i) => iso(T0 + 60 + i)) });
  assert.equal(busy.runsUsed, 3);
  // A one-workspace grant is still a window over this workspace's runs.
  const local: GrantRow = { ...POOL, ownerId: null, poolRunsUsed: undefined };
  assert.equal(grantRunsUsed(local, [iso(T0 + 60), iso(T0 + 61)]), 2);
  assert.equal(resolveEntitlement({ ...CLIENT, grants: [local] }).grant?.shared, false);
});

test("a spent pool refuses in every workspace and says the runs were shared; an uncounted pool is read as spent", () => {
  const spent = resolveEntitlement({ ...CLIENT, grants: [{ ...POOL, poolRunsUsed: 50 }] });
  assert.deepEqual([spent.canRun, spent.blocker], [false, "grant_used"]);
  assert.equal(spent.blockedReason, "The pilot grant's 50 runs, shared across the owner's workspaces, have been used.");
  const unknown = resolveEntitlement({ ...CLIENT, grants: [{ ...POOL, poolRunsUsed: undefined }] });
  assert.deepEqual([unknown.canRun, unknown.runsUsed], [false, 50], "the cautious reading: never offer a run the pool may not fund");
  // Fair use is still per workspace, whatever funds the run.
  assert.equal(resolveEntitlement({ ...CLIENT, runsInFlight: 3 }).blocker, "concurrency");
});

test("the funding line names the pool, in the reader's words; a one-workspace pilot reads as before", () => {
  const e = resolveEntitlement(CLIENT);
  assert.equal(fundingLine(e, false, true), `Pilot · 47 of 50 runs left (shared across your workspaces) · until ${POOL.endsAt!.slice(0, 10)}`);
  assert.equal(fundingLine(e, false), `Pilot · 47 of 50 runs left (shared across the owner's workspaces) · until ${POOL.endsAt!.slice(0, 10)}`);
  assert.equal(fundingDetail(e, true), fundingLine(e, false, true));
  assert.equal(sharedAcross(true), "shared across your workspaces");
  const local = resolveEntitlement({ ...CLIENT, grants: [{ ...POOL, ownerId: null }], runTimes: [iso(T0 + 60)] });
  assert.equal(fundingLine(local, false, true), `Pilot · 49 of 50 runs left · until ${POOL.endsAt!.slice(0, 10)}`);
  assert.equal(ifKeyRemoved(e, { used: 3, limit: 3 }),
    "Runs would then grade on Novera's keys, still counted against the pilot's runs (47 of 50 left, shared across the owner's workspaces).");
});

test("model work on Novera's keys under a grant or plan is plan_managed; on the workspace's key, its key", () => {
  assert.equal(modelWorkFunding("workspace_key", "plan_managed"), "workspace_key");
  assert.equal(modelWorkFunding("trial_free", "plan_managed"), "plan_managed");
  assert.equal(modelWorkFunding("trial_free", "trial_free"), "trial_free");
  assert.equal(modelWorkFunding("trial_free", null), "trial_free", "nothing funds runs: the trial allowance, as before 0076");
  const src = readFileSync("src/lib/providers/model-work.ts", "utf8");
  assert.match(src, /export type Funding = "trial_free" \| "workspace_key" \| "plan_managed";/);
  assert.match(src, /workspaceEntitlement\(args\)/, "the same decision a run start makes");
});

test("a client workspace's report says the grant was its owner's, and the public receipt shows it", () => {
  assert.equal(gradingFundedBy("plan_managed", "owner_grant"), OWNER_GRANT_FUNDED);
  assert.equal(OWNER_GRANT_FUNDED, "Novera, under a grant to the workspace's owner");
  assert.equal(gradingFundedBy("plan_managed", "grant"), GRANT_FUNDED, "a one-workspace grant is stated as before");
  const payload = { novera: { format: 14 }, run: { grading_funded_by: OWNER_GRANT_FUNDED } } as unknown as Json;
  const digest = contentHash(payload);
  const receipt = buildReceipt(digest, { content_hash: digest, payload, revoked_at: null, created_at: "2026-10-17T10:00:00Z" } as never);
  assert.equal(receipt.state === "verified" ? receipt.details.fundedBy : null, OWNER_GRANT_FUNDED);
  const run = readFileSync("src/lib/workflow/execute-run.ts", "utf8");
  assert.match(run, /serviceClient\(\)\.from\("billing_entitlement_grants"\)\.select\("owner_id"\)\.eq\("id", grantId\)/,
    "read with the service role: the grant is usually held by another of the owner's workspaces");
});

test("a pool spent by a start elsewhere is refused with its own sentence", () => {
  const pool = refusalFromInsert("grant_exhausted: grant g allows 50 runs across the owner's workspaces and 50 have started");
  assert.deepEqual([pool?.message, pool?.blocker], ["The grant's runs, shared across the owner's workspaces, have been used.", "grant_used"]);
  assert.equal(refusalFromInsert("grant_exhausted: grant g allows 5 runs and 5 have started")?.message, "The grant's runs have been used.");
});

// ------------------------------------------------------------------ redeeming, and what is said

test("redeeming: one pilot per owner, said to the owner and to an admin in their own words", () => {
  assert.deepEqual(readPilotOutcome({ outcome: "owner_has_pilot" }), { outcome: "owner_has_pilot" });
  assert.equal(readPilotOutcome({ outcome: "workspace_has_pilot" }), null, "0075's outcome is no longer answered, and never misread");

  const owner = pilotOutcomeMessage({ outcome: "owner_has_pilot" });
  assert.equal(owner.text, "You already have a pilot; it covers every workspace you own. Ask us through Support if you need more runs.");
  assert.deepEqual(owner.link, { href: "/support", phrase: "Support" });
  const admin = pilotOutcomeMessage({ outcome: "owner_has_pilot" }, "UTC", false);
  assert.equal(admin.text, "This workspace's owner already has a pilot; it covers every workspace they own. Ask us through Support if you need more runs.");
  assert.ok(admin.text.includes(admin.link!.phrase));

  const redeemed = { outcome: "redeemed" as const, grant_id: "g", runs_allowed: 50, ends_at: "2026-11-16T10:00:00Z" };
  assert.equal(pilotOutcomeMessage(redeemed).text, "Pilot unlocked: 50 runs until 16 November 2026, shared across every workspace you own.");
  assert.equal(pilotOutcomeMessage(redeemed, "UTC", false).text, "Pilot unlocked: 50 runs until 16 November 2026, shared across all of the owner's workspaces.");

  const line = { runsAllowed: 50, runsUsed: 3, endsAt: "2026-11-16T10:00:00Z", shared: true };
  assert.equal(pilotGrantLine(line, "UTC", true), "Pilot · 47 of 50 runs left (shared across your workspaces) · ends 16 November 2026");
  assert.equal(pilotGrantLine(line), "Pilot · 47 of 50 runs left (shared across the owner's workspaces) · ends 16 November 2026");
  assert.equal(pilotGrantLine({ ...line, shared: false }), "Pilot · 47 of 50 runs left · ends 16 November 2026");

  const action = readFileSync("src/lib/billing/pilot-actions.ts", "utf8");
  assert.match(action, /const ownerViewing = role === "owner";/);
  assert.equal(count(action, "ownerViewing)"), 2, "both answers are said from the person's side");
});

test("the application reads the owner's pool wherever it reads grants", () => {
  const store = readFileSync("src/lib/billing/supabase-store.ts", "utf8");
  assert.match(store, /\.or\(`workspace_id\.eq\.\$\{workspaceId\},owner_id\.eq\.\$\{owner\}`\)/);
  assert.match(store, /!UUID\.test\(workspaceId\) \|\| \(owner && !UUID\.test\(owner\)\)/, "only ids reach the filter string");
  const rows = readFileSync("src/lib/billing/rows.ts", "utf8");
  const pool = rows.slice(rows.indexOf("export async function withPoolCounts"), rows.indexOf("export async function ownerPoolsInForce"));
  assert.match(pool, /\.eq\("funded_by_grant", g\.id\)\.eq\(ALLOWANCE_COLUMN, true\)/, "the database's count: by grant id, empty aborts free");
  assert.match(readFileSync("src/components/shell/top-bar.tsx", "utf8"), /viewerIsOwner: role === "owner"/);
  assert.match(readFileSync("src/app/(app)/dashboard/page.tsx", "utf8"), /fundingDetail\(entitlement\.billing, role === "owner"\)/);
  assert.match(readFileSync("src/app/(app)/settings/workspace-settings.tsx", "utf8"), /fundingDetail\(entitlement\.billing, role === "owner"\)/);
  const workspaces = readFileSync("src/app/(app)/workspaces/page.tsx", "utf8");
  assert.match(workspaces, /ownerPoolsInForce\(serviceClient\(\), ctx\.user\.id\)/, "the person's own pool, by their own id");
  assert.match(workspaces, /shared across every workspace you own/);
  const erase = readFileSync("src/app/(app)/settings/identity-forms.tsx", "utf8");
  assert.match(erase, /Erasing it ends the \{sharedGrant\} for all/);
  const apply = readFileSync("src/app/apply/page.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(apply, /Already have a code\?/);
  assert.match(apply, /then enter it under Settings → Billing, in “Have a pilot code\?”/);
});

test("language rule: every new sentence and the pages and guides that carry them pass", () => {
  const sentences = [
    ...Object.values(PILOT_MESSAGES),
    sharedAcross(true), sharedAcross(false), OWNER_GRANT_FUNDED,
    resolveEntitlement({ ...CLIENT, grants: [{ ...POOL, poolRunsUsed: 50 }] }).blockedReason!,
    ...["src/app/apply/page.tsx", "src/app/(app)/workspaces/page.tsx", "src/app/(app)/settings/identity-forms.tsx",
      "src/app/(app)/settings/billing/page.tsx", "data/docs/the-trial-and-your-own-key.md", "data/docs/finding-your-way.md"]
      .map((p) => readFileSync(p, "utf8")),
  ];
  for (const s of sentences) assert.deepEqual(scanCustomerLanguage(s), [], s.slice(0, 80));
  const guide = readFileSync("data/docs/the-trial-and-your-own-key.md", "utf8").replace(/\s+/g, " ");
  assert.match(guide, /its runs cover every workspace you own, including client workspaces you add afterwards/);
  assert.match(guide, /an account owner redeems one code/);
  assert.match(guide, /erasing that workspace ends the pilot for all of your workspaces/);
});
