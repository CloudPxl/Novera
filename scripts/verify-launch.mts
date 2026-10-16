/**
 * The automated launch checks, printed as a table: the same list /readiness shows to staff
 * (src/lib/readiness/launch-checks.ts), so the page and this command cannot disagree.
 *
 *   npm run verify:launch               against the database in .env.local
 *   npm run verify:launch -- --strict   a check waiting on a person (email, company details) fails too
 *
 * Read-only: selects only, no write, no migration, no seed. Configuration is reported as present
 * or absent, never as a value. Colour only when stdout is a terminal.
 *
 * Exit: 0 no check failed; 1 at least one failed (with --strict, or is waiting on a person).
 * Each failing row prints the command or page that resolves it.
 */
import { diskLaunchFiles, launchExitCode, runLaunchChecks, supabaseLaunchDb, type CheckStatus } from "../src/lib/readiness/launch-checks.ts";

const strict = process.argv.includes("--strict");
const tty = Boolean(process.stdout.isTTY);
const paint = (code: number, text: string) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const WORD: Record<CheckStatus, string> = { pass: paint(32, "PASS   "), fail: paint(31, "FAIL   "), pending: paint(33, "WAITING") };

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in .env.local.");
  process.exit(1);
}

let host = "unknown host";
try { host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host; } catch { /* printed as unknown */ }
console.log(`\nLaunch checks against ${host}${strict ? " (strict)" : ""}\n`);

const checks = await runLaunchChecks({ db: await supabaseLaunchDb(), files: diskLaunchFiles() });
const width = Math.max(...checks.map((c) => c.title.length));
for (const c of checks) {
  console.log(`  ${WORD[c.status]}  ${c.title.padEnd(width)}  ${c.detail}`);
  if (c.remediation) console.log(`  ${" ".repeat(7)}  ${" ".repeat(width)}  -> ${c.remediation}`);
}

const failed = checks.filter((c) => c.status === "fail").length;
const waiting = checks.filter((c) => c.status === "pending").length;
const passed = checks.length - failed - waiting;
console.log(`\n  ${passed} passed, ${failed} failed, ${waiting} waiting on a person${strict && waiting ? " (counted as failing)" : ""}.\n`);
process.exit(launchExitCode(checks, strict));
