import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { scenarioDigest, suiteDigest } from "../src/lib/suites/digest.ts";
import { suiteChangelog, previousVersion, nextVersion } from "../src/lib/suites/changelog.ts";
import { classifiedVersions, parseRegistration, registryProblems, tierFor, tierOf, TIERS, TIER_LABELS, TIER_DESCRIPTIONS } from "../src/lib/suites/tiers.ts";
import { buildCatalog, matchesFilter, parseCatalogFilter, type SuiteRow } from "../src/lib/suites/catalog.ts";
import { buildRunManifest, manifestForNewRun } from "../src/lib/report/manifest.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import type { Suite, SuiteCase } from "../src/lib/runner/types.ts";

/**
 * The suite registry: digests, tiers, computed changelogs, the catalog, and the suite digest
 * in a new run's manifest. Every expectation is re-derived from the files on disk.
 */

const DIR = "data/suites";
const read = (file: string) => JSON.parse(readFileSync(`${DIR}/${file}`, "utf8"));
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const SUITE_FILES = FILES.filter((f) => validateSuite(read(f)).ok);
const suite = (file: string): Suite => {
  const r = validateSuite(read(file));
  if (!r.ok) throw new Error(`${file}: ${r.errors.join("; ")}`);
  return r.suite;
};
const v4 = suite("eu-support-v4.json");
const v5 = suite("eu-support-v5.json");
const v6 = suite("eu-support-v6.json");

/* ------------------------------------------------------------------ digests */

test("a suite file's digest is the digest of the row the seeder stores from it", () => {
  // The seeder inserts validateSuite's output; `note` is never stored. A file whose digest
  // differed from its row's would make the catalog and a manifest disagree with the repository.
  assert.ok(SUITE_FILES.length >= 7);
  for (const file of SUITE_FILES) {
    const raw = read(file);
    const row = suite(file);
    assert.equal(suiteDigest(raw), suiteDigest(row), file);
    // Through jsonb and back: key order is not part of the digest.
    const reordered = JSON.parse(JSON.stringify({ cases: row.cases, name: row.name, version: row.version, key: row.key }));
    assert.equal(suiteDigest(reordered), suiteDigest(row), `${file} reordered`);
    assert.match(suiteDigest(row), /^[0-9a-f]{64}$/);
  }
});

test("the digest covers the name and every scenario, and not the file's note", () => {
  const base = suiteDigest(v5);
  assert.notEqual(suiteDigest({ ...v5, name: `${v5.name}.` }), base);
  assert.notEqual(suiteDigest({ ...v5, cases: v5.cases.slice(1) }), base);
  assert.notEqual(suiteDigest({ ...v5, cases: [v5.cases[1], v5.cases[0], ...v5.cases.slice(2)] }), base, "order is declared");
  assert.equal(suiteDigest({ ...v5, note: "commentary" } as Suite), base);
});

/* --------------------------------------------------------------- changelog */

test("eu-support v4 → v5, computed: T42–T49 added, the other 41 unchanged", () => {
  const log = suiteChangelog(v4, v5);
  assert.deepEqual(log.added, ["T42", "T43", "T44", "T45", "T46", "T47", "T48", "T49"]);
  assert.deepEqual(log.retired, []);
  assert.deepEqual(log.redefined, []);
  assert.equal(log.unchanged.length, 41);
  assert.deepEqual(log.unchanged, v4.cases.map((c) => c.id));
});

test("a changed definition under the same id is redefined, a missing id retired, ids in natural order", () => {
  const changed = { ...v5.cases[0], expected_behavior: `${v5.cases[0].expected_behavior} Changed.` };
  const next = { cases: [changed, ...v5.cases.slice(2), { ...v5.cases[3], id: "T100" }, { ...v5.cases[3], id: "T9" }] };
  const log = suiteChangelog(v5, next);
  assert.deepEqual(log.redefined, ["T01"]);
  assert.deepEqual(log.retired, ["T02"]);
  assert.deepEqual(log.added, ["T9", "T100"]);
  assert.equal(log.unchanged.length, 47);
  assert.deepEqual(suiteChangelog(null, v4).added.length, 41);
});

test("the previous version is the next-lower stored version of the same key", () => {
  const rows = [{ key: "a", version: 1 }, { key: "a", version: 3 }, { key: "b", version: 2 }, { key: "a", version: 5 }];
  assert.deepEqual(previousVersion(rows, rows[3]), { key: "a", version: 3 });
  assert.equal(previousVersion(rows, rows[0]), null);
  assert.equal(previousVersion(rows, rows[2]), null);
  assert.deepEqual(nextVersion(rows, rows[0]), { key: "a", version: 3 });
  assert.equal(nextVersion(rows, rows[3]), null);
});

/* -------------------------------------------------------------------- tiers */

test("eu-support-v5.tiers.json classifies exactly v5's 49 scenarios, each with a known tier", () => {
  const sidecar = read("eu-support-v5.tiers.json");
  assert.deepEqual(Object.keys(sidecar).sort(), ["purpose", "suite", "tiers", "version"]);
  assert.equal(sidecar.suite, "eu-support");
  assert.equal(sidecar.version, 5);
  assert.ok(sidecar.purpose.length > 40);
  assert.deepEqual(Object.keys(sidecar.tiers).sort(), v5.cases.map((c) => c.id).sort());
  assert.equal(Object.keys(sidecar.tiers).length, 49);
  for (const [id, tier] of Object.entries(sidecar.tiers)) assert.ok((TIERS as readonly string[]).includes(tier as string), `${id}: ${tier}`);
  for (const t of TIERS) assert.ok(TIER_LABELS[t] && TIER_DESCRIPTIONS[t]);
});

test("every registered sidecar is well formed and agrees with every other", () => {
  assert.deepEqual(registryProblems(), []);
});

test("every *.tiers.json on disk is registered in src/lib/suites/tiers.ts", () => {
  const onDisk = FILES.filter((f) => f.endsWith(".tiers.json")).map((f) => {
    const t = read(f);
    return `${t.suite} v${t.version}`;
  }).sort();
  const registered = classifiedVersions().map((c) => `${c.key} v${c.version}`).sort();
  assert.deepEqual(registered, onDisk);
  for (const f of FILES.filter((x) => x.endsWith(".tiers.json"))) {
    const t = read(f);
    assert.equal(f, `${t.suite}-v${t.version}.tiers.json`, "named after the suite version it classifies");
  }
});

test("a sidecar beside the wrong suite, an unknown tier or a missing id is reported, not trusted", () => {
  const sidecar = read("eu-support-v5.tiers.json");
  assert.match(parseRegistration({ tiers: sidecar, suite: read("eu-support-v4.json") }).problems.join(), /not eu-support v5/);
  const bad = parseRegistration({ tiers: { ...sidecar, tiers: { ...sidecar.tiers, T01: "urgent" } }, suite: v5 });
  assert.match(bad.problems.join(), /T01 has "urgent"/);
  assert.equal(bad.classified!.scenarios.has("T01"), false, "an invalid tier is no tier");
  const { T02: _dropped, ...rest } = sidecar.tiers;
  void _dropped;
  assert.match(parseRegistration({ tiers: { ...sidecar, tiers: rest }, suite: v5 }).problems.join(), /T02 is not classified/);
});

test("v5's own scenarios read their tier from the v5 sidecar", () => {
  const sidecar = read("eu-support-v5.tiers.json");
  for (const c of v5.cases) {
    assert.deepEqual(tierOf("eu-support", 5, c), { tier: sidecar.tiers[c.id], from: 5 });
  }
});

test("an older version inherits a tier only for a scenario whose definition is identical", () => {
  const sidecar = read("eu-support-v5.tiers.json");
  // v4 carries 41 scenarios byte-identical to v5's: every one inherits.
  for (const c of v4.cases) assert.equal(tierFor("eu-support", 4, c), sidecar.tiers[c.id], c.id);
  // v3's T22 was redefined in v4 (the read-back was added): not classified. The rest inherit.
  const v3 = suite("eu-support-v3.json");
  const t22 = v3.cases.find((c) => c.id === "T22")!;
  assert.notEqual(scenarioDigest(t22), scenarioDigest(v5.cases.find((c) => c.id === "T22")!));
  assert.equal(tierFor("eu-support", 3, t22), null);
  assert.equal(v3.cases.filter((c) => tierFor("eu-support", 3, c) !== null).length, 35);
  // Any change at all makes it a different test.
  const edited: SuiteCase = { ...v5.cases[4], severity: "low" };
  assert.equal(tierFor("eu-support", 4, edited), null);
  assert.equal(tierFor("eu-support", 5, edited), null, "not even under the classified version's own number");
  // Another key, or a workspace suite that reuses this key with its own scenarios, gets nothing.
  assert.equal(tierFor("docs-support", 2, suite("novera-support-v2.json").cases[0]), null);
  assert.equal(tierFor("eu-support", 5, { ...v5.cases[0], id: "T99" }), null);
});

/* ------------------------------------------------------------------ catalog */

function rowsFromDisk(): SuiteRow[] {
  return SUITE_FILES.map((f, i) => ({ id: `row-${i}`, ...suite(f) }));
}

test("the catalog groups by key, newest first, with every figure computed from the rows", () => {
  const rows = rowsFromDisk();
  const catalog = buildCatalog(rows);
  const eu = catalog.find((s) => s.key === "eu-support")!;
  assert.deepEqual(eu.versions.map((v) => v.version), [7, 6, 5, 4, 3, 2, 1]);
  const [n7, n6, n5, n4, , , n1] = eu.versions;
  assert.deepEqual(n7.changes?.log.redefined, ["T22", "T35"]);
  assert.equal(n7.supersededBy, null);
  assert.equal(n6.supersededBy, 7);
  assert.equal(n6.digest, suiteDigest(v6));
  assert.equal(n6.scenarios.length, 49);
  assert.equal(n6.byTier.unclassified, 0);
  assert.deepEqual(n6.changes?.from, 5);
  assert.deepEqual(n6.changes?.log.redefined, ["T22", "T26", "T33", "T35", "T39", "T46"]);
  assert.deepEqual(n6.changes?.log.added, []);
  assert.equal(n5.digest, suiteDigest(v5));
  assert.equal(n5.scenarios.length, 49);
  assert.equal(n5.byTier.unclassified, 0);
  assert.equal(Object.values(n5.byTier).reduce((a, b) => a + b, 0), 49);
  assert.equal(Object.values(n5.bySeverity).reduce((a, b) => a + b, 0), 49);
  assert.equal(n5.bySeverity.critical, v5.cases.filter((c) => c.severity === "critical").length);
  assert.deepEqual(n5.changes?.from, 4);
  assert.deepEqual(n5.changes?.log.added, ["T42", "T43", "T44", "T45", "T46", "T47", "T48", "T49"]);
  assert.equal(n5.supersededBy, 6);
  assert.equal(n4.supersededBy, 5);
  // The newest classified version holding the identical definition: v6 for what v6 kept, v5 for
  // the five v4 scenarios v6 redefined (T46 is not in v4).
  // v7 for what v6 and v7 kept from v4, v5 for the five v4 scenarios v6 redefined.
  const redefinedIn6 = new Set(["T22", "T26", "T33", "T35", "T39"]);
  assert.ok(n4.scenarios.every((s) => s.tierFrom === (redefinedIn6.has(s.id) ? 5 : 7)));
  assert.equal(n1.changes, null);
  assert.equal(n1.byTier.unclassified, 16, "v1's scenarios were all redefined in v3");
  const docs = catalog.find((s) => s.key === "docs-support")!;
  assert.deepEqual(docs.versions[0].changes?.log.redefined, ["D01"]);
});

test("the catalog's filters come from the address, and anything unknown means all", () => {
  assert.deepEqual(parseCatalogFilter({ tier: "business_rule", severity: "high" }), { tier: "business_rule", severity: "high" });
  assert.deepEqual(parseCatalogFilter({ tier: "<script>", severity: ["low", "high"] }), { tier: null, severity: "low" });
  assert.deepEqual(parseCatalogFilter({}), { tier: null, severity: null });
  const n5 = buildCatalog(rowsFromDisk()).find((s) => s.key === "eu-support")!.versions[0];
  const critical = n5.scenarios.filter((s) => matchesFilter(s, { tier: "statutory_critical", severity: "critical" }));
  assert.ok(critical.length > 0 && critical.every((s) => s.tier === "statutory_critical" && s.severity === "critical"));
  assert.equal(n5.scenarios.filter((s) => matchesFilter(s, { tier: "unclassified", severity: null })).length, 0);
});

/* ----------------------------------------------------------------- manifest */

const BASE = {
  runId: "run-1", createdAt: "2026-10-15T00:00:00.000Z", agentId: "agent-1", agentUrl: "https://agent.example.com/hook",
  policyId: "pol-1", policyVersion: 3, suiteId: "suite-1", suiteKey: "eu-support", suiteVersion: 5,
  caseIds: v5.cases.map((c) => c.id), judgeSource: "trial_free" as const, passThreshold: 80, runnerVersion: "1.0.0",
};

test("a manifest names the suite's digest, and the digest is part of what its hash covers", () => {
  const digest = suiteDigest(v5);
  const { manifest, hash } = buildRunManifest({ ...BASE, suiteDigest: digest });
  assert.equal(manifest.suite_digest, digest);
  assert.equal(hash, contentHash(manifest as unknown as Json));
  assert.notEqual(buildRunManifest({ ...BASE, suiteDigest: "f".repeat(64) }).hash, hash);
  // A caller that predates it declares no digest rather than a guessed one.
  assert.equal("suite_digest" in buildRunManifest(BASE).manifest, false);
});

/** Just enough of a Supabase client for `manifestForNewRun`'s three reads. */
function fakeClient(rows: Record<string, Record<string, unknown>>): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) }) }),
    }),
  } as unknown as SupabaseClient;
}

test("a new run's manifest records the digest of the suite row it will execute", async () => {
  // The row as Postgres returns it: jsonb, keys in its own order, the file's note not stored.
  const row = JSON.parse(JSON.stringify({ name: v5.name, cases: v5.cases, version: 5, key: "eu-support" }));
  const declared = await manifestForNewRun({
    client: fakeClient({ agents: { config: { url: "https://agent.example.com/hook" } }, policies: { version: 3 }, suites: row }),
    agentId: "agent-1", policyId: "pol-1", suiteId: "suite-1", judgeSource: "trial_free",
  });
  assert.ok(declared.manifest);
  assert.equal(declared.manifest!.suite_digest, suiteDigest(v5));
  assert.equal(declared.manifest!.suite_digest, suiteDigest(read("eu-support-v5.json")), "the file in the repository");
  assert.deepEqual(declared.manifest!.suite.case_ids, BASE.caseIds);
  assert.equal(declared.manifest_hash, contentHash(declared.manifest as unknown as Json));
});
