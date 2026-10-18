/**
 * Pilot codes, for the operator (0075, docs/BILLING-DECISIONS.md "Pilot codes").
 *
 *   npm run pilot:code -- create --code PILOT-EXAMPLE-30 --label "Example agency, 30-day pilot" --granted-by you@example.com
 *       [--runs 50] [--days 30] [--max 1] [--redeem-by 2026-12-31] [--yes]
 *   npm run pilot:code -- create --generate --name EXAMPLE --label "…" --granted-by you@example.com [same options]
 *   npm run pilot:code -- list
 *   npm run pilot:code -- revoke --code PILOT-EXAMPLE-30 --reason "Offer withdrawn" [--yes]
 *   npm run pilot:code -- revoke --ref 1a2b3c4d --reason "…" [--yes]
 *
 * Only the code's HMAC is stored. `create --code` never prints the code back (you typed it);
 * `create --generate` prints the code it made exactly once. Creating a code that exists with the
 * same terms changes nothing; with other terms it is refused: terms are frozen, so revoke it and
 * create another. Every write names the database first and needs --yes unless it is local.
 *
 * Exit codes: 0 done or unchanged · 3 refused (bad input, conflict, wrong target, wrong key).
 */
import { parseArgs } from "node:util";
import { generatePilotCode, hashPilotCode, normalisePilotCode, sanitiseCodeName } from "../src/lib/billing/pilot-codes.ts";
import {
  announce, checkEncryptionKey, connect, createPilotCode, describe, fail, findPilotCode, listPilotCodes,
  readTerms, resolveUserId,
} from "./pilot-code-cli.mts";

const [command, ...rest] = process.argv.slice(2);

let flags: Record<string, string | boolean | undefined>;
try {
  ({ values: flags } = parseArgs({
    args: rest,
    options: {
      code: { type: "string" }, generate: { type: "boolean" }, name: { type: "string" },
      runs: { type: "string" }, days: { type: "string" }, max: { type: "string" }, "redeem-by": { type: "string" },
      label: { type: "string" }, "granted-by": { type: "string" }, ref: { type: "string" }, reason: { type: "string" },
      yes: { type: "boolean" },
    },
    strict: true,
  }));
} catch (e) {
  fail(`${e instanceof Error ? e.message : String(e)}\nUsage: npm run pilot:code -- create | list | revoke (see scripts/pilot-code.mts).`);
}
const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
const yes = flags.yes === true;

const attempt = <T,>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
};

if (command === "create") {
  const generate = flags.generate === true;
  if (generate === Boolean(str("code"))) fail("Give either --code <code> or --generate --name <name>.");
  if (generate && !sanitiseCodeName(str("name") ?? "")) fail("--generate needs --name with at least one letter or digit.");
  const terms = attempt(() => readTerms({ runs: str("runs"), days: str("days"), max: str("max"), redeemBy: str("redeem-by"), label: str("label") }));
  if (!str("granted-by")) fail("--granted-by <email> is required: the Novera account that offers the pilot.");
  const given = generate ? null : normalisePilotCode(str("code"));
  if (!generate && !given) fail("That is not a pilot code: letters, digits and dashes, 8 to 64 characters.");

  const target = connect();
  announce(target, true, yes);
  const key = await checkEncryptionKey(target.db);
  if (key === "unknown") console.log("Note: no stored credential to check NOVERA_ENCRYPTION_KEY against; make sure it is the deployment's.");
  const grantedBy = await resolveUserId(target.db, str("granted-by")!);

  let code = given;
  if (generate) {
    // 20 random bits: a collision with an existing code is unlikely, and is simply drawn again.
    for (let i = 0; i < 5 && !code; i++) {
      const candidate = attempt(() => generatePilotCode(str("name")!, terms.days));
      const { data } = await target.db.from("billing_pilot_codes").select("code_hash").eq("code_hash", hashPilotCode(candidate)).maybeSingle();
      if (!data) code = candidate;
    }
    if (!code) fail("Could not draw an unused code; try again.");
  }

  const result = await createPilotCode(target.db, code!, terms, grantedBy).catch((e: Error) => fail(e.message));
  if (result.status === "conflict") {
    fail(`A code with that value already exists with different terms: ${describe(result.row)}. Terms are frozen; revoke it and create another.`);
  }
  if (result.status === "unchanged") {
    console.log(`Already exists, unchanged: ${describe(result.row)}`);
  } else {
    console.log(`Created: ${describe(result.row)}`);
    if (generate) {
      console.log(`\n  ${code}\n`);
      console.log("Store this code now and send it to the agency. Novera keeps only its hash and cannot show it again.");
    }
  }
} else if (command === "list") {
  const target = connect();
  announce(target, false, yes);
  const rows = await listPilotCodes(target.db).catch((e: Error) => fail(e.message));
  if (!rows.length) {
    console.log("No pilot codes.");
  } else {
    console.log("ref       hint              runs  days  used     redeem by    status             label");
    for (const r of rows) {
      const status = r.revoked_at ? `revoked ${r.revoked_at.slice(0, 10)}` : r.redemptions_count >= r.max_redemptions ? "used up" : r.expires_at && Date.parse(r.expires_at) <= Date.now() ? "past redeem-by" : "open";
      console.log([
        r.code_hash.slice(0, 8).padEnd(9),
        r.hint.padEnd(17),
        String(r.runs_allowed).padStart(4),
        String(r.duration_days).padStart(5),
        `${r.redemptions_count}/${r.max_redemptions}`.padStart(6).padEnd(8),
        (r.expires_at ? r.expires_at.slice(0, 10) : "—").padEnd(12),
        status.padEnd(18),
        r.label + (r.revoked_reason ? ` (revoked: ${r.revoked_reason})` : ""),
      ].join(" "));
    }
  }
} else if (command === "revoke") {
  const reason = (str("reason") ?? "").trim();
  if (reason.length < 3 || reason.length > 500) fail("--reason is required: 3 to 500 characters.");
  if (Boolean(str("code")) === Boolean(str("ref"))) fail("Name the code with either --code <code> or --ref <reference from list>.");
  const target = connect();
  announce(target, true, yes);
  if (str("code")) {
    const key = await checkEncryptionKey(target.db);
    if (key === "unknown") console.log("Note: no stored credential to check NOVERA_ENCRYPTION_KEY against.");
  }
  const row = await findPilotCode(target.db, { code: str("code"), ref: str("ref") }).catch((e: Error) => fail(e.message));
  if (!row) fail("No such pilot code in this database.");
  if (row.revoked_at) {
    console.log(`Already revoked on ${row.revoked_at.slice(0, 10)} (${row.revoked_reason}); unchanged: ${describe(row)}`);
  } else {
    const { data, error } = await target.db.from("billing_pilot_codes")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
      .eq("code_hash", row.code_hash).is("revoked_at", null).select("code_hash");
    if (error) fail(`Could not revoke: ${error.message}`);
    if (!data?.length) fail("The code was revoked by someone else just now; run list to see it.");
    console.log(`Revoked: ${describe(row)}. Grants already redeemed from it stay in force; revoke those grants separately if needed.`);
  }
} else {
  fail("Usage: npm run pilot:code -- create | list | revoke (see scripts/pilot-code.mts for the options).");
}
