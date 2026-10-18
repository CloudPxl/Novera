/**
 * Creates pilot codes from a CSV file the operator keeps outside the repository.
 *
 *   npm run seed:pilot-codes -- --file ~/novera/outreach.pilot-codes.csv --granted-by you@example.com [--max 1] [--redeem-by 2026-12-31] [--yes]
 *
 * The file has one code per line, `code,runs,days,label` (a header line is optional; an empty runs
 * or days takes 50 or 30). A file inside this repository's working tree is refused, so a list of
 * real codes can never be committed to a public repository by accident; .gitignore also ignores
 * `*.pilot-codes.csv` and `pilot-codes*.csv` as a second line of defence.
 *
 * Each code is created idempotently, exactly as `npm run pilot:code -- create` does: the same code
 * with the same terms is left unchanged, the same code with other terms is refused (terms are
 * frozen). The whole file is read and checked before anything is written. Codes are never
 * printed — only their hints.
 *
 * Exit codes: 0 every line created or unchanged · 3 refused before writing, or a line conflicted.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  announce, checkEncryptionKey, connect, createPilotCode, describe, fail, parsePilotCsv, readTerms,
  refuseInsideRepository, resolveUserId, type Terms,
} from "./pilot-code-cli.mts";

let flags: Record<string, string | boolean | undefined>;
try {
  ({ values: flags } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string" }, "granted-by": { type: "string" }, max: { type: "string" },
      "redeem-by": { type: "string" }, yes: { type: "boolean" },
    },
    strict: true,
  }));
} catch (e) {
  fail(`${e instanceof Error ? e.message : String(e)}\nUsage: npm run seed:pilot-codes -- --file <path outside the repository> --granted-by <email> [--yes]`);
}
const file = typeof flags.file === "string" ? flags.file : "";
const grantedByEmail = typeof flags["granted-by"] === "string" ? flags["granted-by"] : "";
if (!file) fail("--file <path> is required: a CSV kept outside the repository.");
if (!grantedByEmail) fail("--granted-by <email> is required: the Novera account that offers the pilots.");

refuseInsideRepository(file);

let lines: ReturnType<typeof parsePilotCsv>;
let terms: Array<{ line: number; code: string; terms: Terms }>;
try {
  lines = parsePilotCsv(readFileSync(file, "utf8"));
  terms = lines.map((l) => {
    try {
      return {
        line: l.line, code: l.code,
        terms: readTerms({ runs: l.runs, days: l.days, label: l.label, max: typeof flags.max === "string" ? flags.max : undefined, redeemBy: typeof flags["redeem-by"] === "string" ? flags["redeem-by"] : undefined }),
      };
    } catch (e) {
      throw new Error(`Line ${l.line}: ${e instanceof Error ? e.message.replace(/^--label is required/, "the label is required") : String(e)}`);
    }
  });
} catch (e) {
  fail(`${e instanceof Error ? e.message : String(e)} Nothing was written.`);
}
if (!terms.length) fail("The file has no codes. Nothing was written.");

const target = connect();
announce(target, true, flags.yes === true);
if ((await checkEncryptionKey(target.db)) === "unknown") {
  console.log("Note: no stored credential to check NOVERA_ENCRYPTION_KEY against; make sure it is the deployment's.");
}
const grantedBy = await resolveUserId(target.db, grantedByEmail);

let created = 0;
let unchanged = 0;
let conflicts = 0;
for (const t of terms) {
  const result = await createPilotCode(target.db, t.code, t.terms, grantedBy).catch((e: Error) => fail(`Line ${t.line}: ${e.message}`));
  if (result.status === "created") created++;
  if (result.status === "unchanged") unchanged++;
  if (result.status === "conflict") conflicts++;
  const word = result.status === "created" ? "created  " : result.status === "unchanged" ? "unchanged" : "REFUSED  ";
  console.log(`line ${String(t.line).padStart(3)}  ${word}  ${describe(result.row)}${result.status === "conflict" ? " — exists with other terms; revoke it and create another" : ""}`);
}
console.log(`\n${created} created, ${unchanged} unchanged, ${conflicts} refused.`);
if (conflicts) process.exit(3);
