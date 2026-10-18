import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  PILOT_ATTEMPT_LIMIT, PILOT_CODE_MAX_LENGTH, PILOT_MESSAGES, generatePilotCode, hashPilotCode, longDate,
  normalisePilotCode, pilotAttemptsRefusal, pilotCodeHint, pilotGrantLine, pilotOutcomeMessage, readPilotOutcome,
  sanitiseCodeName,
} from "../src/lib/billing/pilot-codes.ts";
import { hashKey } from "../src/lib/api/keys.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { AUDIT_LABEL } from "../src/lib/audit/record.ts";
import {
  insideDirectory, parsePilotCsv, readTerms, redeemBy, repositoryRoots, sameTerms, type CodeRow,
} from "../scripts/pilot-code-cli.mts";

/**
 * Pilot codes (0075). A code an agency types becomes a pilot grant in one transaction; the code
 * itself is never stored. These tests hold the shared rules (normalising, hashing, the hint, the
 * generator, what a person is told), the migration's guarantees as text, and the CLI's refusal to
 * read a codes file from inside this public repository. The database behaviour is proved on the
 * local stack (docs/BILLING-DECISIONS.md, "Pilot codes").
 *
 * Only placeholders appear here: PILOT-EXAMPLE-30 and generated codes. A real company's code
 * never enters the repository (the last test looks).
 */

const SECRET = Buffer.alloc(32, 7).toString("base64");
const M0075 = readFileSync("supabase/migrations/0075_pilot_codes.sql", "utf8");

test("normalising: trimmed, spaces removed, capitals, typographic dashes read as '-'", () => {
  assert.equal(normalisePilotCode("PILOT-EXAMPLE-30"), "PILOT-EXAMPLE-30");
  assert.equal(normalisePilotCode("  pilot-example-30 \n"), "PILOT-EXAMPLE-30");
  assert.equal(normalisePilotCode("PILOT - EXAMPLE - 30"), "PILOT-EXAMPLE-30");
  assert.equal(normalisePilotCode("pilot–example—30"), "PILOT-EXAMPLE-30", "en and em dashes from a mail client");
  assert.equal(normalisePilotCode("PILOT EXAMPLE-30"), "PILOTEXAMPLE-30", "a non-breaking space is a space");
});

test("normalising refuses anything else before any hashing", () => {
  for (const bad of [
    "", "   ", "SHORT-1", "PILOT_EXAMPLE_30", "PILOT-EXAMPLE-30!", "PILOT/EXAMPLE/30", "PILÖT-EXAMPLE-30",
    "PILOT-STRAßE-30", // "ß".toUpperCase() is "SS": letters are checked before casing
    "PILOT-EXAMPLE-30;drop", "x".repeat(PILOT_CODE_MAX_LENGTH + 1),
  ]) {
    assert.equal(normalisePilotCode(bad), null, JSON.stringify(bad));
  }
  for (const notString of [null, undefined, 42, {}, ["PILOT-EXAMPLE-30"]]) {
    assert.equal(normalisePilotCode(notString), null);
  }
  assert.equal(normalisePilotCode("ABCDEFGH"), "ABCDEFGH", "eight characters is the minimum");
  assert.equal(normalisePilotCode("A".repeat(64)), "A".repeat(64), "sixty-four is the maximum");
});

test("hashing: HMAC-SHA256 under the server secret, labelled apart from API keys", () => {
  const h = hashPilotCode("PILOT-EXAMPLE-30", SECRET);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashPilotCode("PILOT-EXAMPLE-30", SECRET), h, "deterministic: the CLI and the app agree");
  assert.notEqual(hashPilotCode("PILOT-EXAMPLE-30", Buffer.alloc(32, 8).toString("base64")), h, "another secret, another hash");
  assert.notEqual(hashKey("PILOT-EXAMPLE-30", SECRET), h, "the API key label is a different HMAC key");
  assert.notEqual(hashPilotCode("PILOT-EXAMPLE-31", SECRET), h);
  assert.throws(() => hashPilotCode("pilot-example-30", SECRET), /normalised/, "only a normalised code is hashed");
  const saved = process.env.NOVERA_ENCRYPTION_KEY;
  delete process.env.NOVERA_ENCRYPTION_KEY;
  try {
    assert.throws(() => hashPilotCode("PILOT-EXAMPLE-30"), /NOVERA_ENCRYPTION_KEY/, "no default secret");
  } finally {
    if (saved !== undefined) process.env.NOVERA_ENCRYPTION_KEY = saved;
  }
});

test("the hint shows at most half the code and, for the documented formats, no part of the name", () => {
  assert.equal(pilotCodeHint("PILOT-EXAMPLE-30"), "PILOT…30");
  assert.equal(pilotCodeHint("ABCDEFGH"), "AB…H");
  for (let n = 8; n <= 64; n++) {
    const code = "A".repeat(n);
    const shown = pilotCodeHint(code).replace("…", "").length;
    assert.ok(shown <= n / 2, `${n} characters: ${shown} shown`);
  }
  for (let i = 0; i < 200; i++) {
    const code = generatePilotCode("EXAMPLE", 30);
    const hint = pilotCodeHint(code);
    const random = code.split("-")[2];
    assert.equal(hint, "PILOT-…30", "the prefix and the days, never the name or the random part");
    assert.ok(!hint.replace("PILOT-…", "").includes(random));
  }
});

test("the generator: PILOT-<NAME>-<4 random base32>-<days>, from the system's randomness", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const code = generatePilotCode("Example", 30);
    assert.match(code, /^PILOT-EXAMPLE-[0-9A-HJKMNP-TV-Z]{4}-30$/, "Crockford base32: no I, L, O, U");
    assert.equal(normalisePilotCode(code), code);
    codes.add(code);
  }
  assert.ok(codes.size > 450, `500 draws gave ${codes.size} distinct codes`);
  assert.equal(sanitiseCodeName("Café & Co. Ltd"), "CAFECOLTD");
  assert.match(generatePilotCode("Sämple & Co.", 45), /^PILOT-SAMPLECO-[0-9A-Z]{4}-45$/);
  const long = generatePilotCode("X".repeat(200), 365);
  assert.ok(long.length <= PILOT_CODE_MAX_LENGTH, `${long.length} characters`);
  assert.match(long, /-365$/);
  assert.throws(() => generatePilotCode("---", 30), /letter or digit/);
  assert.throws(() => generatePilotCode("EXAMPLE", 0), /Days/);
  assert.throws(() => generatePilotCode("EXAMPLE", 366), /Days/);
  assert.throws(() => generatePilotCode("EXAMPLE", 1.5), /Days/);
});

test("what a person is told, outcome by outcome", () => {
  const redeemed = pilotOutcomeMessage({ outcome: "redeemed", grant_id: "g", runs_allowed: 50, ends_at: "2026-11-16T10:00:00Z" });
  assert.deepEqual(redeemed, { tone: "notice", text: "Pilot unlocked: 50 runs until 16 November 2026, shared across every workspace you own." });
  assert.equal(
    pilotOutcomeMessage({ outcome: "redeemed", grant_id: "g", runs_allowed: 50, ends_at: "2026-11-16T23:30:00Z" }, "Europe/Bucharest").text,
    "Pilot unlocked: 50 runs until 17 November 2026, shared across every workspace you own.", "the date in the person's timezone",
  );
  assert.deepEqual(pilotOutcomeMessage({ outcome: "used_up" }), { tone: "error", text: "This code has already been used." });

  // One pilot per owner (0076), covering every workspace they own.
  const has = pilotOutcomeMessage({ outcome: "owner_has_pilot" });
  assert.equal(has.text, "You already have a pilot; it covers every workspace you own. Ask us through Support if you need more runs.");
  assert.deepEqual(has.link, { href: "/support", phrase: "Support" });
  assert.ok(has.text.includes(has.link!.phrase));

  const invalid = pilotOutcomeMessage({ outcome: "invalid" });
  assert.equal(invalid.text, "That code is not valid. Check it, or request a pilot.");
  assert.deepEqual(invalid.link, { href: "/apply", phrase: "request a pilot" });
  assert.ok(invalid.text.includes(invalid.link!.phrase));
  assert.ok(!/mailto:/.test(JSON.stringify([has, invalid])), "in-app links, no mailto");

  assert.equal(pilotAttemptsRefusal(12), "That is more pilot code attempts than Novera accepts at once. Try again in about 12 minutes.");
  assert.equal(pilotAttemptsRefusal(1), "That is more pilot code attempts than Novera accepts at once. Try again in a minute.");
  assert.deepEqual(PILOT_ATTEMPT_LIMIT, { max: 5, windowSeconds: 900 });
  assert.equal(pilotGrantLine({ runsAllowed: 50, runsUsed: 3, endsAt: "2026-11-16T10:00:00Z" }), "Pilot · 47 of 50 runs left · ends 16 November 2026");
  assert.equal(pilotGrantLine({ runsAllowed: 50, runsUsed: 60, endsAt: null }), "Pilot · 0 of 50 runs left");
  assert.equal(longDate("2026-11-16T10:00:00Z", "Not/AZone"), "16 November 2026", "an unknown timezone falls back to UTC");
  assert.equal(AUDIT_LABEL["billing.pilot_code_redeemed"], "redeemed a pilot code");
});

test("the RPC's answer is read defensively: anything unexpected is not a redemption", () => {
  assert.deepEqual(readPilotOutcome({ outcome: "redeemed", grant_id: "g", runs_allowed: 50, ends_at: "2026-11-16T10:00:00Z" }),
    { outcome: "redeemed", grant_id: "g", runs_allowed: 50, ends_at: "2026-11-16T10:00:00Z" });
  assert.deepEqual(readPilotOutcome({ outcome: "used_up" }), { outcome: "used_up" });
  for (const junk of [null, "redeemed", {}, { outcome: "redeemed" }, { outcome: "redeemed", grant_id: 1, runs_allowed: 50, ends_at: "x" }, { outcome: "granted" }]) {
    assert.equal(readPilotOutcome(junk), null, JSON.stringify(junk));
  }
});

test("language rule: every sentence about pilot codes passes", () => {
  const sentences = [
    ...Object.values(PILOT_MESSAGES),
    pilotOutcomeMessage({ outcome: "redeemed", grant_id: "g", runs_allowed: 50, ends_at: "2026-11-16T10:00:00Z" }).text,
    pilotAttemptsRefusal(9),
    readFileSync("src/app/(app)/settings/billing/pilot-form.tsx", "utf8"),
    readFileSync("src/app/(app)/settings/billing/page.tsx", "utf8"),
    readFileSync("data/docs/the-trial-and-your-own-key.md", "utf8"),
  ];
  for (const s of sentences) assert.deepEqual(scanCustomerLanguage(s), [], s.slice(0, 80));
});

test("0075: codes are stored as an HMAC with frozen terms, a count that only climbs, and one revocation", () => {
  assert.match(M0075, /code_hash\s+text primary key check \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.doesNotMatch(M0075, /\bcode\s+text\b/, "no plaintext column");
  assert.match(M0075, /runs_allowed\s+integer not null default 50 check \(runs_allowed between 1 and 500\)/);
  assert.match(M0075, /duration_days\s+integer not null default 30 check \(duration_days between 1 and 365\)/);
  assert.match(M0075, /max_redemptions\s+integer not null default 1 check \(max_redemptions >= 1\)/);
  assert.match(M0075, /check \(redemptions_count between 0 and max_redemptions\)/);
  assert.match(M0075, /check \(\(revoked_at is null\) = \(revoked_reason is null\)\)/);
  assert.match(M0075, /'A pilot code is revoked, not deleted\.'/);
  assert.match(M0075, /'A pilot code''s terms are frozen; revoke it and create another\.'/);
  assert.match(M0075, /new\.redemptions_count <> old\.redemptions_count \+ 1/);
  assert.match(M0075, /'A revoked pilot code stays revoked\.'/);
  assert.match(M0075, /'A revoked pilot code takes no redemption\.'/);
  assert.match(M0075, /'An expired pilot code takes no redemption\.'/);
  assert.match(M0075, /before insert or update or delete on billing_pilot_codes/);
  assert.match(M0075, /alter table billing_pilot_codes enable row level security;/);
  assert.match(M0075, /revoke all on billing_pilot_codes from public, anon, authenticated;/);
  assert.doesNotMatch(M0075, /create policy \S+ on billing_pilot_codes\b/, "no policy on codes: server only");
});

test("0075: one redemption per workspace, append-only, readable by owner/admin without the hash, erased with its grant", () => {
  assert.match(M0075, /unique \(code_hash, workspace_id\)/);
  assert.match(M0075, /unique \(workspace_id\)/);
  assert.match(M0075, /grant_id\s+uuid not null unique references billing_entitlement_grants \(id\) on delete cascade/);
  assert.match(M0075, /workspace_id uuid not null references workspaces \(id\) on delete cascade/);
  assert.match(M0075, /before update or delete on billing_pilot_code_redemptions\s+for each row execute function refuse_mutation\(\)/);
  assert.match(M0075, /refuse_cross_workspace\('grant_id', 'billing_entitlement_grants'\)/);
  assert.match(M0075, /using \(has_workspace_role\(workspace_id, array\['owner', 'admin'\]\)\)/);
  assert.match(M0075, /revoke all on billing_pilot_code_redemptions from public, anon, authenticated;/);
  assert.match(M0075, /grant select \(id, workspace_id, grant_id, redeemed_by, created_at\) on billing_pilot_code_redemptions to authenticated;/);
  // Erasure rides on the grant erase_workspace already deletes; its body is not redefined here.
  assert.doesNotMatch(M0075, /create or replace function erase_workspace/);
  assert.match(readFileSync("supabase/migrations/0068_contract_acceptances.sql", "utf8"), /delete from billing_entitlement_grants\s+where workspace_id = target;/);
});

test("0075: redeeming is one service-role transaction that locks the code and never names it", () => {
  const at = M0075.indexOf("create or replace function redeem_pilot_code(");
  const fn = M0075.slice(at, M0075.indexOf("$$;", at));
  assert.match(fn, /security definer\s+set search_path = public/);
  assert.match(M0075, /revoke all on function redeem_pilot_code\(text, uuid, uuid\) from public, anon, authenticated;/);
  assert.match(fn, /role in \('owner', 'admin'\)/, "the role checked again in the database");
  assert.match(fn, /from billing_pilot_codes where code_hash = p_code_hash for update/);
  // The workspace's own pilot is checked before the code is looked at: no oracle for codes.
  assert.ok(fn.indexOf("'workspace_has_pilot'") < fn.indexOf("for update"));
  // Unknown, revoked and expired are one answer.
  assert.match(fn, /if not found or c\.revoked_at is not null or \(c\.expires_at is not null and now\(\) >= c\.expires_at\) then\s+return jsonb_build_object\('outcome', 'invalid'\);/);
  assert.match(fn, /'Pilot code ' \|\| c\.hint \|\| ' redeemed'/, "the reason names the hint");
  assert.doesNotMatch(fn, /c\.label/, "the internal label never reaches a grant, an event or the audit trail");
  assert.match(fn, /make_interval\(days => c\.duration_days\)/);
  assert.match(fn, /insert into billing_events [\s\S]*'pilot_code\.redeemed'/);
  assert.match(fn, /insert into audit_events [\s\S]*'billing\.pilot_code_redeemed'/);
  assert.doesNotMatch(fn.slice(fn.indexOf("insert into billing_events")), /code_hash/, "neither trail carries the code's hash");
  assert.match(fn, /exception when unique_violation then/);
});

test("the redeem action: billing.manage, counted before hashing, three limits that refuse when uncounted", () => {
  const src = readFileSync("src/lib/billing/pilot-actions.ts", "utf8");
  assert.match(src, /gate\(user\.id, workspace\.id, "billing\.manage"\)/);
  const limit = src.indexOf("rateLimit(");
  assert.ok(limit > 0 && limit < src.indexOf("normalisePilotCode(raw)") && limit < src.indexOf("hashPilotCode("), "counted before normalising and hashing");
  for (const who of ["pilot-code-person", "pilot-code-workspace", "pilot-code-address"]) assert.ok(src.includes(`"${who}"`), who);
  assert.equal((src.match(/onError: "refuse"/g) ?? []).length, 3);
  assert.doesNotMatch(src, /form\.get\("(?!code")/, "the code is the only field read");
  const page = readFileSync("src/app/(app)/settings/billing/page.tsx", "utf8");
  assert.doesNotMatch(page, /contact support<\/Link> for a pilot grant/);
  assert.match(page, /href="\/apply"/);
  assert.doesNotMatch(page, /mailto:/);
  const form = readFileSync("src/app/(app)/settings/billing/pilot-form.tsx", "utf8");
  assert.match(form, /useKeepValuesOnError\(state\)/);
  assert.match(form, /autoComplete="off"/);
  assert.match(form, /spellCheck=\{false\}/);
  assert.doesNotMatch(form, /pilot-codes\.ts/, "the hashing module never reaches a client bundle");
});

test("CLI: a codes file inside the repository is refused, through symbolic links too", () => {
  const repo = resolve(".");
  assert.ok(repositoryRoots().some((r) => insideDirectory(join(repo, "package.json"), r)));
  assert.ok(insideDirectory(join(repo, "outreach.pilot-codes.csv"), repo), "a file that does not exist yet is judged by its directory");
  assert.ok(insideDirectory(join(repo, "docs", "nested", "x.csv"), repo));
  assert.ok(insideDirectory(repo, repo));
  const outside = mkdtempSync(join(tmpdir(), "pilot-codes-"));
  try {
    const file = join(outside, "codes.csv");
    writeFileSync(file, "code,runs,days,label\n");
    assert.equal(insideDirectory(file, repo), false);
    const link = join(outside, "link.csv");
    symlinkSync(join(repo, "package.json"), link);
    assert.equal(insideDirectory(link, repo), true, "a link into the repository is inside it");
    assert.equal(insideDirectory(`${repo}-sibling/x.csv`, repo), false, "a sibling whose name starts the same is outside");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
  const gitignore = readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /^\*\.pilot-codes\.csv$/m);
  assert.match(gitignore, /^pilot-codes\*\.csv$/m);
  const seed = readFileSync("scripts/seed-pilot-codes.mts", "utf8");
  assert.ok(seed.indexOf("refuseInsideRepository(file)") < seed.indexOf("readFileSync(file"), "checked before the file is read");
});

test("CLI: the CSV, the terms and idempotency", () => {
  const rows = parsePilotCsv("﻿code,runs,days,label\r\nPILOT-EXAMPLE-30,50,30,\"Example agency, 30-day pilot\"\n pilot-sample-60 ,,60,Sample\n\n");
  assert.deepEqual(rows, [
    { line: 2, code: "PILOT-EXAMPLE-30", runs: "50", days: "30", label: "Example agency, 30-day pilot" },
    { line: 3, code: "PILOT-SAMPLE-60", runs: undefined, days: "60", label: "Sample" },
  ]);
  assert.throws(() => parsePilotCsv("PILOT-EXAMPLE-30,50,30"), /Line 1: expected 4 columns/);
  assert.throws(() => parsePilotCsv("PILOT_EXAMPLE,50,30,x"), /Line 1: the code is not valid/);
  assert.throws(() => parsePilotCsv("PILOT-EXAMPLE-30,50,30,a\npilot-example-30,50,30,b"), /twice/);
  try {
    parsePilotCsv("PILOT-EXAMPLE-30!,50,30,x");
    assert.fail("refused");
  } catch (e) {
    assert.doesNotMatch((e as Error).message, /EXAMPLE/, "an error names the line, never the code");
  }

  assert.deepEqual(readTerms({ label: "Example" }), { runs: 50, days: 30, max: 1, expiresAt: null, label: "Example" });
  assert.throws(() => readTerms({ label: "" }), /--label is required/);
  assert.throws(() => readTerms({ label: "x", runs: "501" }), /--runs must be from 1 to 500/);
  assert.throws(() => readTerms({ label: "x", days: "0" }), /--days must be from 1 to 365/);
  assert.throws(() => readTerms({ label: "x", runs: "5.5" }), /whole number/);
  assert.equal(redeemBy("2026-12-31", new Date("2026-10-17T00:00:00Z")), "2026-12-31T23:59:59Z");
  assert.throws(() => redeemBy("2026-02-30", new Date("2026-01-01T00:00:00Z")), /a date like/);
  assert.throws(() => redeemBy("2026-10-16", new Date("2026-10-17T00:00:00Z")), /already past/);

  const row: CodeRow = {
    code_hash: "a".repeat(64), hint: "PILOT…30", label: "Example", runs_allowed: 50, duration_days: 30, max_redemptions: 1,
    redemptions_count: 0, expires_at: "2026-12-31T23:59:59+00:00", granted_by: "u1", created_at: "2026-10-17T00:00:00Z",
    revoked_at: null, revoked_reason: null,
  };
  const terms = { runs: 50, days: 30, max: 1, expiresAt: "2026-12-31T23:59:59Z", label: "Example" };
  assert.equal(sameTerms(row, terms, "u1"), true, "the same moment written two ways is the same");
  assert.equal(sameTerms(row, { ...terms, runs: 60 }, "u1"), false);
  assert.equal(sameTerms(row, { ...terms, label: "Other" }, "u1"), false);
  assert.equal(sameTerms(row, terms, "u2"), false);
  assert.equal(sameTerms(row, { ...terms, expiresAt: null }, "u1"), false);

  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["pilot:code"], "node --no-warnings --conditions=react-server --env-file=.env.local scripts/pilot-code.mts");
  assert.equal(pkg.scripts["seed:pilot-codes"], "node --no-warnings --conditions=react-server --env-file=.env.local scripts/seed-pilot-codes.mts");
});

test("confidentiality: no code-shaped string in the repository except placeholders", () => {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return; // not a git checkout: nothing to scan
  }
  const found: string[] = [];
  for (const file of files) {
    if (!/\.(ts|tsx|mts|md|sql|json|csv|txt|ya?ml)$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/\bPILOT-([A-Z0-9]{2,})-/g)) {
      if (!/^(EXAMPLE|SAMPLE)/.test(m[1])) found.push(`${file}: PILOT-${m[1]}-…`);
    }
  }
  assert.deepEqual(found, [], "a real company's pilot code belongs in the founder's file outside the repository");
});
