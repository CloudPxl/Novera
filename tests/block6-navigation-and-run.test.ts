import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentHref, navFor, sectionTabOf, SECTIONS, type AccountMode } from "../src/components/shell/nav-model.ts";
import { deliverableFor } from "../src/app/(app)/runs/[id]/deliverable.ts";
import { buildAttention } from "../src/app/(app)/dashboard/attention.ts";
import { heldSentence, idleWords, lastProgressAt, NOTHING_LOST, STALL_AFTER_MS, stallState, stalledSentence, type RunProgress } from "../src/lib/workflow/stalled.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

// ------------------------------------------------------------------ navigation

const MODES: Array<{ mode: AccountMode; multi: boolean }> = [
  { mode: "personal", multi: false },
  { mode: "personal", multi: true },
  { mode: "agency", multi: false },
  { mode: "enterprise", multi: true },
];

test("five places in the order the work happens, plus Workspaces and Audit in enterprise", () => {
  const labels = (mode: AccountMode, multi = false, canAudit = true) => navFor({ mode, multi, agentCount: 1, canAudit }).map((i) => i.label);
  assert.deepEqual(labels("personal"), ["Dashboard", "My agent", "Scenarios", "My runs", "Settings"]);
  assert.deepEqual(navFor({ mode: "personal", multi: false, agentCount: 3, canAudit: false }).map((i) => i.label)[1], "My agents");
  assert.deepEqual(labels("personal", true), ["Dashboard", "Agents", "Scenarios", "Runs", "Settings"]);
  assert.deepEqual(labels("agency"), ["Dashboard", "Agents", "Scenarios", "Runs", "Settings"]);
  assert.deepEqual(labels("enterprise", true), ["Dashboard", "Workspaces", "Agents", "Scenarios", "Runs", "Audit", "Settings"]);
  // Audit is drawn only for a role that may read it.
  assert.equal(labels("enterprise", true, false).includes("Audit"), false);
  // No grouped silos any more: every entry is one link.
  for (const m of MODES) for (const e of navFor({ ...m, agentCount: 1, canAudit: true })) assert.equal("items" in e, false);
});

/** Every operator address that existed before Block 6, and the place that lights for it. */
const LEGACY: Array<[path: string, place: string | null]> = [
  ["/dashboard", "/dashboard"],
  ["/runs", "/runs"],
  ["/runs/4f818e86-c53c-44c0-9c37-97add6df076e", "/runs"],
  ["/runs/compare", "/runs"],
  ["/review", "/runs"],
  ["/reports", "/runs"],
  ["/scenarios", "/scenarios"],
  ["/suites", "/scenarios"],
  ["/builder", "/scenarios"],
  ["/builder/b1", "/scenarios"],
  ["/regressions", "/scenarios"],
  ["/agents", "/agents"],
  ["/agents/new", "/agents"],
  ["/agents/a1", "/agents"],
  ["/settings", "/settings"],
  ["/settings/profile", "/settings"],
  ["/settings/members", "/settings"],
  ["/billing", "/settings"],
  ["/welcome", null],
];

test("every legacy route lights the place it belongs to, in every account mode", () => {
  for (const m of MODES) {
    const nav = navFor({ ...m, agentCount: 1, canAudit: true });
    for (const [path, place] of LEGACY) {
      assert.equal(currentHref(path, nav), place, `${m.mode}${m.multi ? " (several workspaces)" : ""}: ${path}`);
    }
  }
});

test("the closest match wins: Audit in enterprise, Settings elsewhere; Workspaces only where offered", () => {
  const enterprise = navFor({ mode: "enterprise", multi: true, agentCount: 1, canAudit: true });
  const agency = navFor({ mode: "agency", multi: false, agentCount: 1, canAudit: true });
  assert.equal(currentHref("/settings/audit", enterprise), "/settings/audit");
  assert.equal(currentHref("/settings/audit", agency), "/settings");
  assert.equal(currentHref("/workspaces", enterprise), "/workspaces");
  assert.equal(currentHref("/workspaces", agency), null);
  // A prefix is a path segment, never a string prefix: /reportsx is not Reports.
  assert.equal(currentHref("/reportsx", agency), null);
  assert.equal(currentHref("/runs-old", agency), null);
});

test("section tabs: every secondary view is a tab of its place, and every tab address resolves to itself", () => {
  const cases: Array<[string, string, string, string]> = [
    ["/runs", "", "runs", "runs"],
    ["/review", "?view=closed", "runs", "review"],
    ["/reports", "", "runs", "reports"],
    ["/runs/compare", "", "runs", "compare"],
    ["/scenarios", "", "scenarios", "library"],
    ["/scenarios", "?tab=catalog", "scenarios", "catalog"],
    ["/scenarios", "?view=catalog", "scenarios", "catalog"],
    ["/scenarios", "?tab=drafts", "scenarios", "drafts"],
    ["/scenarios", "?tab=create", "scenarios", "create"],
    ["/scenarios", "?tab=nonsense", "scenarios", "library"],
    ["/suites", "", "scenarios", "catalog"],
    ["/builder", "", "scenarios", "builder"],
    ["/regressions", "", "scenarios", "regressions"],
  ];
  for (const [path, search, section, tab] of cases) {
    assert.deepEqual(sectionTabOf(path, search), { section, tab }, `${path}${search}`);
  }
  // A run, a loaded comparison's run and an agent are not section tabs.
  assert.equal(sectionTabOf("/runs/r1"), null);
  assert.equal(sectionTabOf("/agents"), null);
  for (const [key, { tabs }] of Object.entries(SECTIONS)) {
    for (const t of tabs) {
      const [path, search = ""] = t.href.split("?");
      assert.deepEqual(sectionTabOf(path, search ? `?${search}` : ""), { section: key, tab: t.key }, t.href);
    }
  }
  // Each place's tabs light that place in the bar.
  const nav = navFor({ mode: "agency", multi: false, agentCount: 1, canAudit: false });
  for (const t of SECTIONS.runs.tabs) assert.equal(currentHref(t.href.split("?")[0], nav), "/runs");
  for (const t of SECTIONS.scenarios.tabs) assert.equal(currentHref(t.href.split("?")[0], nav), "/scenarios");
});

test("the bar and the menu mark the current place for assistive tech, inside named nav landmarks", () => {
  const links = readFileSync(new URL("../src/components/shell/nav-links.tsx", import.meta.url), "utf8");
  assert.match(links, /aria-current=\{active \? "page" : undefined\}/);
  const bar = readFileSync(new URL("../src/components/shell/top-bar.tsx", import.meta.url), "utf8");
  assert.match(bar, /<nav aria-label="Primary"/);
  const section = readFileSync(new URL("../src/components/shell/section-nav.tsx", import.meta.url), "utf8");
  assert.match(section, /<nav aria-label=\{`\$\{label\} section`\}/);
  assert.match(section, /aria-current=\{active \? "page" : undefined\}/);
});

// ------------------------------------------------------------------ deliverable bar

const sealed = { token: "tok_abc", content_hash: "a".repeat(64), revoked_at: null, expires_at: "2026-11-15T00:00:00Z" };
const base = { runId: "r2", runStatus: "completed", exploratory: false, fixture: false, report: sealed, readiness: "READY_TO_SHARE" as const, previousRunId: "r1", now: new Date("2026-10-16T12:00:00Z") };

test("a completed run with a sealed, open report gets the bar: report, print, seal check, comparison", () => {
  const d = deliverableFor(base);
  assert.equal(d.kind, "share");
  if (d.kind !== "share") return;
  assert.equal(d.reportHref, "/report/tok_abc");
  // The report prints, not the operator page.
  assert.equal(d.printHref, "/report/tok_abc?print=1");
  assert.equal(d.verifyHref, `/verify/${"a".repeat(64)}`);
  assert.equal(d.compareHref, "/runs/compare?base=r1&target=r2");
  assert.equal(d.readiness, "READY_TO_SHARE");
  assert.equal(deliverableFor({ ...base, previousRunId: null }).kind, "share");
  assert.equal((deliverableFor({ ...base, previousRunId: null }) as { compareHref: string | null }).compareHref, null);
});

test("no bar for a run that is unsealed, aborted, in flight or an exploratory scan", () => {
  assert.equal(deliverableFor({ ...base, report: null }).kind, "none");
  assert.equal(deliverableFor({ ...base, runStatus: "aborted" }).kind, "none");
  assert.equal(deliverableFor({ ...base, runStatus: "running" }).kind, "none");
  assert.equal(deliverableFor({ ...base, exploratory: true }).kind, "none");
});

test("a withdrawn or expired report is stated, with nothing to share", () => {
  const withdrawn = deliverableFor({ ...base, report: { ...sealed, revoked_at: "2026-10-15T09:30:00Z" } });
  assert.deepEqual(withdrawn, { kind: "withdrawn", at: "2026-10-15T09:30:00Z" });
  const expired = deliverableFor({ ...base, report: { ...sealed, expires_at: "2026-10-01T00:00:00Z" } });
  assert.deepEqual(expired, { kind: "expired", at: "2026-10-01T00:00:00Z" });
});

test("a fixture report is labelled as test data, and readiness is carried, never raised", () => {
  const d = deliverableFor({ ...base, fixture: true, readiness: "READY_FOR_INTERNAL_REVIEW" });
  assert.equal(d.kind, "share");
  if (d.kind !== "share") return;
  assert.equal(d.fixture, true);
  assert.equal(d.readiness, "READY_FOR_INTERNAL_REVIEW");
  const bar = readFileSync(new URL("../src/app/(app)/runs/[id]/deliverable-bar.tsx", import.meta.url), "utf8");
  assert.match(bar, /Test data: Novera&apos;s scripted fixture/);
});

test("each deliverable action appears once on the run page", () => {
  const page = readFileSync(new URL("../src/app/(app)/runs/[id]/page.tsx", import.meta.url), "utf8");
  const bar = readFileSync(new URL("../src/app/(app)/runs/[id]/deliverable-bar.tsx", import.meta.url), "utf8");
  const both = page + bar;
  const count = (re: RegExp) => (both.match(re) ?? []).length;
  assert.equal(count(/>View client report</g), 1);
  assert.equal(count(/Open the client report/g), 0);
  assert.equal(count(/<SealInspector/g), 1);
  assert.equal(count(/<BadgeShare/g), 1);
  assert.equal(count(/\?print=1/g), 0, "the print address is built in deliverable.ts only");
  // The comparison with the previous run: in the bar, or (only without one) beside Rerun.
  assert.match(page, /const compareHere = deliverable\.kind !== "share" && previousRun !== null;/);
});

// ------------------------------------------------------------------ stalled runs

const T0 = Date.parse("2026-10-16T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const run = (over: Partial<RunProgress> = {}): RunProgress => ({
  status: "running", createdAt: iso(T0 - 60 * 60_000), startedAt: iso(T0 - 50 * 60_000), lastCaseAt: iso(T0), leaseUntil: null, ...over,
});

test("stalled: 2:59 is still moving, 3:01 is stalled, measured from the newest stored timestamp", () => {
  assert.equal(stallState(run(), T0 + 179_000).kind, "moving");
  assert.equal(stallState(run(), T0 + STALL_AFTER_MS).kind, "moving", "exactly three minutes is not over three");
  const s = stallState(run(), T0 + 181_000);
  assert.deepEqual(s, { kind: "stalled", idleMs: 181_000, minutes: 3 });
  // No scenario yet: measured from the start, then from creation.
  assert.equal(stallState(run({ lastCaseAt: null, startedAt: iso(T0) }), T0 + 181_000).kind, "stalled");
  assert.equal(stallState(run({ lastCaseAt: null, startedAt: null, createdAt: iso(T0), status: "queued" }), T0 + 179_000).kind, "moving");
  assert.equal(stallState(run({ lastCaseAt: null, startedAt: null, createdAt: iso(T0), status: "queued" }), T0 + 181_000).kind, "stalled");
  assert.equal(lastProgressAt(run()), T0);
});

test("a held lease is another process advancing it, never stalled; an expired lease is not held", () => {
  const held = stallState(run({ leaseUntil: iso(T0 + 10 * 60_000) }), T0 + 5 * 60_000);
  assert.equal(held.kind, "held");
  assert.equal(stallState(run({ leaseUntil: iso(T0 + 4 * 60_000) }), T0 + 5 * 60_000).kind, "stalled");
  // Held and recent: just moving.
  assert.equal(stallState(run({ leaseUntil: iso(T0 + 60_000) }), T0 + 30_000).kind, "moving");
});

test("a completed or aborted run is never stalled", () => {
  assert.deepEqual(stallState(run({ status: "completed" }), T0 + 24 * 3_600_000), { kind: "settled" });
  assert.deepEqual(stallState(run({ status: "aborted" }), T0 + 24 * 3_600_000), { kind: "settled" });
});

test("how long, in words, and the sentence says nothing is lost", () => {
  assert.equal(idleWords(1), "1 minute");
  assert.equal(idleWords(3), "3 minutes");
  assert.equal(idleWords(89), "89 minutes");
  assert.equal(idleWords(90), "1 hour");
  assert.equal(idleWords(185), "3 hours");
  assert.equal(stalledSentence(12), `This run has not moved for 12 minutes. ${NOTHING_LOST}`);
  assert.equal(NOTHING_LOST, "Nothing is lost: every scenario recorded so far is kept.");
});

test("the dashboard names a stalled run first, with Continue run for a role that may start runs", () => {
  const agents = [{ id: "a1", name: "Support bot", attested_at: "2026-09-01T00:00:00Z" }];
  const common = { agents, outcomes: new Map(), latestProbe: new Map(), draftCount: 0 };
  const moving = stallState(run(), T0 + 60_000);
  const stalled = stallState(run(), T0 + 12 * 60_000);
  const items = buildAttention({
    ...common,
    runs: [{ id: "r-new", status: "running", agent_id: "a1", stall: moving }, { id: "r-old", status: "running", agent_id: "a1", stall: stalled }],
  });
  assert.equal(items[0].href, "/runs/r-old");
  assert.equal(items[0].action, "Continue run");
  assert.equal(items[0].text, `The run against Support bot has not moved for 12 minutes. ${NOTHING_LOST}`);
  // A role that cannot start runs is sent to open it, not offered to continue it.
  const reviewer = buildAttention({ ...common, mayContinue: false, runs: [{ id: "r-old", status: "running", agent_id: "a1", stall: stalled }] });
  assert.equal(reviewer[0].action, "Open it");
  // A held run asks nothing of anyone.
  const held = buildAttention({ ...common, runs: [{ id: "r1", status: "running", agent_id: "a1", stall: stallState(run({ leaseUntil: iso(T0 + 20 * 60_000) }), T0 + 12 * 60_000) }] });
  assert.equal(held[0].tone, "info");
  assert.match(held[0].text, /another process is advancing it/);
  // Still moving: the old sentence, unchanged.
  const plain = buildAttention({ ...common, runs: [{ id: "r1", status: "running", agent_id: "a1", stall: moving }] });
  assert.match(plain[0].text, /has not finished/);
});

test("the run page continues through the one advance path, and only offers Continue when its own attempt is not getting through", () => {
  const live = readFileSync(new URL("../src/app/(app)/runs/[id]/live.tsx", import.meta.url), "utf8");
  assert.match(live, /fetch\(`\/api\/runs\/\$\{runId\}\/execute`/);
  assert.equal((live.match(/fetch\(/g) ?? []).length, 1, "one route, no second way to run");
  assert.match(live, /const showStalled = running && !waiting && attempted && inFlight === 0 && stall\.kind === "stalled";/);
  assert.match(live, /showStalled && mayContinue/);
});

// ------------------------------------------------------------------ language

test("the new sentences pass the customer language rule", () => {
  const sentences = [
    stalledSentence(4), heldSentence(4), stalledSentence(130, "The run against Support bot"),
    ...Object.values(SECTIONS).flatMap((s) => s.tabs.map((t) => t.label)),
    ...navFor({ mode: "enterprise", multi: true, agentCount: 2, canAudit: true }).map((i) => i.label),
  ];
  for (const file of ["../src/app/(app)/runs/[id]/deliverable-bar.tsx", "../src/app/(app)/runs/[id]/copy-link.tsx", "../src/components/shell/section-nav.tsx"]) {
    sentences.push(readFileSync(new URL(file, import.meta.url), "utf8"));
  }
  for (const s of sentences) assert.deepEqual(scanCustomerLanguage(s), [], s.slice(0, 80));
});

// Audit 2026-10-17 (track 7): "Rerun and compare" was a plain form action that threw on any
// refusal — a run id from another workspace, a used-up grant, an archived agent — and the person
// got "This page could not be loaded". Every action that starts a run answers with a sentence.
test("rerun and compare returns a refusal beside its button, never the error page", () => {
  const actions = readFileSync("src/lib/workflow/actions.ts", "utf8");
  const rerun = actions.slice(actions.indexOf("export async function rerunFrom"), actions.indexOf("const JUDGE_PROVIDERS"));
  assert.match(rerun, /rerunFrom\(_prev: FormState, formData: FormData\): Promise<FormState>/);
  assert.doesNotMatch(rerun, /throw new Error/, "a missing run is a sentence, not a throw");
  assert.match(rerun, /e instanceof RunRefusal[\s\S]*return \{ error: e\.message/);
  const page = readFileSync("src/app/(app)/runs/[id]/page.tsx", "utf8");
  assert.doesNotMatch(page, /<form action=\{rerunFrom\}/);
  assert.equal(page.match(/<RefusableForm action=\{rerunFrom\}/g)?.length, 2);
});
