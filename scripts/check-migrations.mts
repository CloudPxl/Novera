/**
 * The migration files, checked without a database. Run by CI; runnable locally.
 *
 *   node scripts/check-migrations.mts                 names and numbering only
 *   node scripts/check-migrations.mts --base <ref>    also: no migration that exists at <ref> was changed
 *
 * `npm run migrate` records a checksum for every file it applies and refuses a ledger and a
 * directory that disagree — but only when it runs against that database. This catches the
 * same mistake at review time: a migration already on main is applied somewhere, so editing
 * it changes nothing there and silently diverges every database created after it. The fix
 * is always a new migration.
 *
 * Fails (exit 1) on: a name that is not `NNNN_snake_case.sql`; two files with one number; a
 * file present at the base that was modified, renamed or deleted.
 * Warns (exit 0) on: a gap in the numbering, and a new file numbered below the base's
 * highest. Parallel branches reserve numbers ahead of merging, so either can be correct for
 * a while — but `migrate` applies in filename order, so a lower number merged after a
 * higher one has been applied runs out of order. The warning says to check that.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = "supabase/migrations";
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrationCheck { errors: string[]; warnings: string[] }

/** Pure: the checks on a list of file names, and on what changed since the base. */
export function checkMigrations(files: string[], base?: { files: string[]; changed: Array<{ status: string; file: string }> }): MigrationCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sql = files.filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) if (!f.endsWith(".sql")) errors.push(`${f}: not a .sql file in ${DIR}`);

  const byNumber = new Map<number, string[]>();
  for (const f of sql) {
    const m = f.match(NAME);
    if (!m) { errors.push(`${f}: name must be NNNN_snake_case.sql`); continue; }
    const n = Number(m[1]);
    byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
  }
  for (const [n, names] of byNumber) if (names.length > 1) errors.push(`number ${String(n).padStart(4, "0")} is used by ${names.join(" and ")}`);

  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      const from = String(numbers[i - 1] + 1).padStart(4, "0");
      const to = String(numbers[i] - 1).padStart(4, "0");
      warnings.push(`numbering skips ${from === to ? from : `${from}–${to}`} (reserved by another branch? it must be merged before this one is applied)`);
    }
  }
  if (numbers[0] !== undefined && numbers[0] !== 1) warnings.push(`numbering starts at ${numbers[0]}, not 0001`);

  if (base) {
    const baseSet = new Set(base.files);
    for (const { status, file } of base.changed) {
      const name = file.replace(`${DIR}/`, "");
      if (!baseSet.has(name)) continue;
      const what = status.startsWith("D") ? "deleted" : status.startsWith("R") ? "renamed" : "modified";
      errors.push(`${name}: ${what} after it was merged — applied migrations are never edited; write a new one`);
    }
    const baseMax = Math.max(0, ...base.files.map((f) => Number(f.match(NAME)?.[1] ?? 0)));
    for (const f of sql) {
      if (baseSet.has(f)) continue;
      const n = Number(f.match(NAME)?.[1] ?? 0);
      if (n && n < baseMax) warnings.push(`${f} is new but numbered below ${String(baseMax).padStart(4, "0")}, which the base already has — it will run after it on any database that is already migrated`);
    }
  }
  return { errors, warnings };
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function isMain(): boolean {
  return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMain()) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--base");
  const baseRef = at >= 0 ? args[at + 1] : undefined;
  const files = readdirSync(DIR).filter((f) => !f.startsWith("."));

  let base: Parameters<typeof checkMigrations>[1];
  // An all-zero "before" is a new branch's first push: there is nothing to compare with.
  if (baseRef && !/^0+$/.test(baseRef)) {
    try {
      git(["cat-file", "-e", `${baseRef}^{commit}`]);
      const baseFiles = git(["ls-tree", "--name-only", `${baseRef}`, `${DIR}/`]).split("\n").filter(Boolean).map((f) => f.replace(`${DIR}/`, ""));
      const changed = git(["diff", "--name-status", "--no-renames", baseRef, "HEAD", "--", DIR]).split("\n").filter(Boolean)
        .map((l) => { const [status, file] = l.split("\t"); return { status, file }; });
      base = { files: baseFiles, changed };
    } catch {
      // A force push's "before" is no longer in the history. Pull requests always have their base.
      console.log(` warn  the base ${baseRef.slice(0, 12)} is not in this clone (a force push, or fetch-depth too shallow); checked without it`);
    }
  }

  const { errors, warnings } = checkMigrations(files, base);
  for (const w of warnings) console.log(` warn  ${w}`);
  for (const e of errors) console.error(` FAIL  ${e}`);
  console.log(errors.length
    ? `\n${errors.length} problem(s) in ${files.length} migration files.`
    : `${files.length} migration files: names and numbers sound${base ? `, nothing merged at ${baseRef!.slice(0, 12)} was changed` : ""}.`);
  process.exit(errors.length ? 1 : 0);
}
