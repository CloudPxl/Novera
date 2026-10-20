import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPlausibleDay } from "../src/lib/regressions/record.ts";

/**
 * Round 2 audit (2026-10-19): workflows driven in a real browser against a local stack, with a
 * mock model. One test per defect found, so none comes back unnoticed. The browser scripts that
 * found them are not part of the suite; these pin the fixes.
 */
const src = (path: string) => readFileSync(path, "utf8");

test("production-failure drafts take the next free id under a race; the database refuses a duplicate (0077)", () => {
  const migration = src("supabase/migrations/0077_regression_draft_ids.sql");
  assert.match(migration, /create unique index scenario_drafts_production_id_unique on public\.scenario_drafts \(workspace_id, \(scenario ->> %L\)\)/);
  assert.match(migration, /create unique index suites_one_per_build/);
  const record = src("src/lib/regressions/record.ts");
  assert.match(record, /for \(let attempt = 0; attempt < 8 && draftError\?\.code === "23505"; attempt\+\+\)/);
  assert.match(record, /built = await draftFor\(\);/, "the id is chosen again after a collision");
});

test("a failure's date is a real day, not in the future; unstorable characters are stored as U+FFFD", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  for (const bad of ["2026-02-31", "0000-00-00", "2099-01-01", "1999-12-31", "2026-13-01", "26-10-19"]) assert.equal(isPlausibleDay(bad, now), false, bad);
  for (const good of ["2026-10-19", "2026-10-20", "2024-02-29", "2000-01-01"]) assert.equal(isPlausibleDay(good, now), true, good);
  assert.match(src("src/lib/regressions/record.ts"), /const input = storableText\(args\.input\);/);
});

test("the Drafts tab never promotes a Suite Builder draft; a racing publish is told plainly", () => {
  assert.match(src("src/lib/workflow/scenarios.ts"), /\.eq\("status", "approved"\)\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+\.is\("build_id", null\)/);
  assert.match(src("src/lib/builder/service.ts"), /if \(error\?\.code === "23505"\) \{[\s\S]{0,300}This build was just published as/);
});

test("Builder forms: the source kind survives a successful add, sizes are checked before sending, limits refuse rather than cut", () => {
  const forms = src("src/app/(app)/builder/forms.tsx");
  assert.match(forms, /<input type="hidden" name="kind" value=\{kind\} \/>/);
  assert.match(forms, /name="kind_choice"/);
  assert.match(forms, /text\.length > SOURCE_TEXT_LIMIT/);
  assert.match(forms, /file\.size > SOURCE_FILE_LIMIT_BYTES/);
  const service = src("src/lib/builder/service.ts");
  assert.doesNotMatch(service, /\.slice\(0, 12\)|answer \?\? ""\)\.trim\(\)\.slice/, "nothing is cut silently");
  assert.match(service, /A scenario holds at most 12 assertions/);
  assert.match(src("src/lib/workflow/builder.ts"), /your text as Novera stores it, with email addresses, phone numbers and card numbers replaced by placeholders/);
});

test("the build page reads 'approved together' from the approvals, never from the address; no missing space", () => {
  const page = src("src/app/(app)/builder/[id]/page.tsx");
  assert.doesNotMatch(page, /\{sp\.grouped\} approved together/);
  assert.match(page, /\.eq\("approval_group", sp\.grouped as string\)\.eq\("approved_by", user\.id\)/);
  assert.match(page, /\.<\/>\}\{" "\}\n\s+A model only proposes/);
  assert.match(src("src/lib/workflow/builder.ts"), /grouped=\$\{result\.group\}/);
});

test("controls appear only for roles that can use them; a resumed schedule says when nothing funds its next run", () => {
  const agent = src("src/app/(app)/agents/[id]/page.tsx");
  assert.match(agent, /<ScheduleCard schedule=\{s\} canChange=\{can\(role, "schedule\.write"\)\} \/>/);
  assert.match(agent, /!can\(role, "schedule\.write"\) \?/);
  assert.match(src("src/app/(app)/regressions/page.tsx"), /\{can\(role, "regression\.record"\) && \(/);
  assert.match(src("src/lib/workflow/schedules.ts"), /it will pause again: \$\{entitlement\.blockedReason\}/);
});

test("the regressions form stays open over its own success; Ask Novera answers in view", () => {
  assert.match(src("src/app/(app)/regressions/page.tsx"), /<KeptOpenDetails initiallyOpen=\{rows\.length === 0\}/);
  assert.match(src("src/components/ui/kept-open-details.tsx"), /useState\(initiallyOpen\)/);
  assert.match(src("src/components/shell/assistant.tsx"), /setDraft\(""\);\n[\s\S]{0,200}setView\("chat"\);\n\s+startTransition/);
});

test("memory's link and instruction checks are in the database too (0077, not valid: new rows)", () => {
  const migration = src("supabase/migrations/0077_regression_draft_ids.sql");
  assert.match(migration, /add constraint assistant_memory_not_link_or_instruction check \([\s\S]*\) not valid;/);
  assert.match(migration, /add constraint assistant_memory_candidates_not_link_or_instruction/);
});

test("erasing a workspace never gives its owner's trial or pilot units back (0078)", () => {
  const m = src("supabase/migrations/0078_erasure_keeps_allowance_spent.sql");
  assert.match(m, /create table if not exists allowance_spent_by_erased_runs/);
  // Written by erase_workspace first, while recorded scenarios still show which runs counted.
  const erase = m.slice(m.indexOf("create or replace function erase_workspace"));
  assert.ok(erase.indexOf("insert into allowance_spent_by_erased_runs") < erase.indexOf("delete from run_cases"), "recorded before the cases go");
  assert.match(m, /used := used \+ \(select count\(\*\) from allowance_spent_by_erased_runs e where e\.owner_id = owner\);/, "the trial cap");
  assert.match(m, /used := used \+ \(select count\(\*\) from allowance_spent_by_erased_runs e where e\.funded_by_grant = g\.id\);/, "an owner-wide pilot");
  assert.match(m, /delete from allowance_spent_by_erased_runs where owner_id = target;/, "erased with the account");
  assert.match(m, /raise exception 'allowance_spent_by_erased_runs is append-only'/);
  // And on screen.
  assert.match(src("src/lib/auth/entitlement.ts"), /const runsUsed = \(count \?\? 0\) \+ \(erased \?\? 0\);/);
  assert.match(src("src/lib/billing/rows.ts"), /poolRunsUsed: \(count \?\? 0\) \+ \(erased \?\? 0\)/);
});

test("the inbox sends only a request's newest draft, once at a time, counts every open request and pages older ones", () => {
  const actions = src("src/lib/support/actions.ts");
  assert.equal((actions.match(/const superseded = await supersededBy\(db, draft\.request_id as string, draftId\);/g) ?? []).length, 2, "approve and send");
  assert.match(actions, /rateLimit\(`inbox-send:\$\{draftId\}`, SEND_CLAIM, \{ onError: "refuse" \}\)/);
  const page = src("src/app/(app)/inbox/page.tsx");
  assert.match(page, /\.not\("status", "in", "\(closed,sent\)"\)/);
  assert.match(page, /Older requests →/);
  assert.match(page, /\.replace\(\/\[\.\\s\]\+\$\/, ""\)/, "no double full stop");
  assert.match(page, /The model wrote no draft; the one below was written by staff\./);
});

test("public forms: line breaks count once; identical submissions at the same moment are stored once", () => {
  const actions = src("src/lib/support/actions.ts");
  assert.match(actions, /\.replace\(\/\\r\\n\?\/g, "\\n"\)\.trim\(\)/);
  assert.match(actions, /fingerprint\(\["support-once", contact\.email, contact\.message\]\)/);
  assert.match(actions, /fingerprint\(\["apply-once", contact\.email, contact\.message\]\)/);
});

test("invitations, roles, deletion and export say what happened, in their own words", () => {
  assert.match(src("src/lib/auth/held-invitation.ts"), /if \(!data \|\| data\.accepted_at \|\| data\.revoked_at\) return null;/);
  assert.match(src("src/app/sign-in/page.tsx"), /const held = await heldInvitationToken\(\);/);
  assert.match(src("src/app/(app)/layout.tsx"), /const pendingInvite = await heldInvitationToken\(\);/);
  const identity = src("src/lib/workflow/identity.ts");
  assert.match(identity, /if \(!\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(id\)\) return \{ error: "That invitation is not open any more\." \};/);
  assert.match(identity, /nobody else can be made owner/);
  assert.match(identity, /redirect\("\/sign-in\?problem=account_deleted"\);/);
  assert.match(src("src/app/auth/confirm/problems.ts"), /account_deleted: "Your account was deleted/);
  assert.match(src("src/app/api/me/export/route.ts"), /if \(request\.method !== "HEAD"\) await recordAudit/);
});
