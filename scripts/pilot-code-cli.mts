/**
 * What `npm run pilot:code` and `npm run seed:pilot-codes` share: the target check, the user
 * lookup, idempotent creation, the CSV reader and the rule that a codes file never lives inside
 * the repository. The hashing itself is the application's (src/lib/billing/pilot-codes.ts), so a
 * code created here hashes to what Settings → Billing computes.
 *
 * Nothing here prints a code. Only `pilot:code create --generate` prints the one it just made.
 */
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PILOT_DEFAULTS, PILOT_LIMITS, hashPilotCode, normalisePilotCode, pilotCodeHint,
} from "../src/lib/billing/pilot-codes.ts";
import { open, secretAad } from "../src/lib/crypto.ts";

// ------------------------------------------------------------------ the target

export function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

export interface Target { db: SupabaseClient; host: string; local: boolean }

/** The database this run writes to, named by host only. Writing anywhere else needs `--yes`. */
export function connect(): Target {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
  const host = new URL(url).hostname;
  return { db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), host, local: isLocalHost(host) };
}

export function announce(target: Target, writes: boolean, yes: boolean): void {
  console.log(`Database: ${target.host}${target.local ? " (local)" : ""}`);
  if (writes && !target.local && !yes) {
    fail(`This writes to ${target.host}, which is not a local database. Run it again with --yes to go ahead.`);
  }
}

export function fail(message: string, code = 3): never {
  console.error(message);
  process.exit(code);
}

/**
 * A code is an HMAC under NOVERA_ENCRYPTION_KEY, so it only works if this shell holds the same
 * key as the deployment. The one way to tell from here is to open a credential the deployment
 * sealed with its key: the plaintext is discarded at once and never printed.
 */
export async function checkEncryptionKey(db: SupabaseClient): Promise<"matches" | "unknown"> {
  if (!process.env.NOVERA_ENCRYPTION_KEY) fail("NOVERA_ENCRYPTION_KEY is not set, so codes cannot be hashed.");
  const { data, error } = await db.from("secrets").select("workspace_id, scope, agent_id, ciphertext, iv, tag").limit(1);
  if (error) fail(`Could not read a stored credential to check NOVERA_ENCRYPTION_KEY: ${error.message}`);
  const row = data?.[0];
  if (!row) return "unknown";
  try {
    void open({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, secretAad(row.workspace_id, row.scope, row.agent_id ?? ""));
    return "matches";
  } catch {
    fail("NOVERA_ENCRYPTION_KEY here does not open the credentials stored in this database, so a code hashed with it would never match what the deployment computes. Use the deployment's key.");
  }
}

/** The user id for an email, through the service-role admin API. */
export async function resolveUserId(db: SupabaseClient, email: string): Promise<string> {
  const wanted = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(wanted)) fail(`--granted-by needs an email address, got ${JSON.stringify(email)}.`);
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Could not list users: ${error.message}`);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (found) return found.id;
    if (data.users.length < 1000) break;
  }
  fail(`No user with the email ${wanted} in this database. --granted-by names the Novera account that offers the pilot.`);
}

// ------------------------------------------------------------------ terms

export interface Terms {
  runs: number;
  days: number;
  max: number;
  /** ISO time after which the code cannot be redeemed, or null. */
  expiresAt: string | null;
  label: string;
}

export interface CodeRow {
  code_hash: string;
  hint: string;
  label: string;
  runs_allowed: number;
  duration_days: number;
  max_redemptions: number;
  redemptions_count: number;
  expires_at: string | null;
  granted_by: string;
  created_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

const COLUMNS = "code_hash, hint, label, runs_allowed, duration_days, max_redemptions, redemptions_count, expires_at, granted_by, created_at, revoked_at, revoked_reason";

function wholeNumber(value: string | undefined, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number from ${min} to ${max}, got ${JSON.stringify(value)}.`);
  const n = Number(value);
  if (n < min || n > max) throw new Error(`${name} must be from ${min} to ${max}, got ${n}.`);
  return n;
}

/** --redeem-by YYYY-MM-DD: redeemable until the end of that day, UTC. Must be in the future. */
export function redeemBy(value: string | undefined, now = new Date()): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`--redeem-by must be a date like 2026-12-31, got ${JSON.stringify(value)}.`);
  }
  const end = `${value}T23:59:59Z`;
  if (Date.parse(end) <= now.getTime()) throw new Error(`--redeem-by ${value} is already past.`);
  return end;
}

export function readTerms(input: { runs?: string; days?: string; max?: string; redeemBy?: string; label?: string }): Terms {
  const label = (input.label ?? "").trim();
  if (!label || label.length > 200) throw new Error("--label is required: 1 to 200 characters, for your own listing. Customers never see it.");
  return {
    runs: wholeNumber(input.runs, "--runs", PILOT_LIMITS.runs.min, PILOT_LIMITS.runs.max, PILOT_DEFAULTS.runs),
    days: wholeNumber(input.days, "--days", PILOT_LIMITS.days.min, PILOT_LIMITS.days.max, PILOT_DEFAULTS.days),
    max: wholeNumber(input.max, "--max", 1, 10_000, PILOT_DEFAULTS.maxRedemptions),
    expiresAt: redeemBy(input.redeemBy),
    label,
  };
}

const sameTime = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));

/** Whether a stored code carries exactly these terms. */
export function sameTerms(row: CodeRow, terms: Terms, grantedBy: string): boolean {
  return row.runs_allowed === terms.runs && row.duration_days === terms.days && row.max_redemptions === terms.max
    && sameTime(row.expires_at, terms.expiresAt) && row.label === terms.label && row.granted_by === grantedBy;
}

export function describe(row: Pick<CodeRow, "hint" | "runs_allowed" | "duration_days" | "max_redemptions" | "expires_at" | "label">): string {
  const uses = row.max_redemptions === 1 ? "single use" : `${row.max_redemptions} redemptions`;
  const by = row.expires_at ? `, redeem by ${row.expires_at.slice(0, 10)} (UTC)` : "";
  return `${row.hint} — ${row.runs_allowed} runs for ${row.duration_days} days from redemption, ${uses}${by} · ${JSON.stringify(row.label)}`;
}

export type CreateResult =
  | { status: "created"; row: CodeRow }
  | { status: "unchanged"; row: CodeRow }
  | { status: "conflict"; row: CodeRow };

async function byHash(db: SupabaseClient, hash: string): Promise<CodeRow | null> {
  const { data, error } = await db.from("billing_pilot_codes").select(COLUMNS).eq("code_hash", hash).maybeSingle();
  if (error) throw new Error(`Could not read pilot codes: ${error.message}`);
  return data as CodeRow | null;
}

/**
 * Creates a code, or finds it. The same code with the same terms is "unchanged"; with other terms
 * it is a conflict, because terms are frozen (0075): revoke it and create another.
 */
export async function createPilotCode(db: SupabaseClient, normalised: string, terms: Terms, grantedBy: string): Promise<CreateResult> {
  const hash = hashPilotCode(normalised);
  const existing = await byHash(db, hash);
  if (existing) return { status: sameTerms(existing, terms, grantedBy) ? "unchanged" : "conflict", row: existing };
  const { data, error } = await db.from("billing_pilot_codes").insert({
    code_hash: hash, hint: pilotCodeHint(normalised), label: terms.label, runs_allowed: terms.runs,
    duration_days: terms.days, max_redemptions: terms.max, expires_at: terms.expiresAt, granted_by: grantedBy,
  }).select(COLUMNS).single();
  if (error) {
    // Created by another run between the read and the insert: read it as the first branch would.
    if (error.code === "23505") {
      const raced = await byHash(db, hash);
      if (raced) return { status: sameTerms(raced, terms, grantedBy) ? "unchanged" : "conflict", row: raced };
    }
    throw new Error(`Could not create the pilot code: ${error.message}`);
  }
  return { status: "created", row: data as CodeRow };
}

export async function listPilotCodes(db: SupabaseClient): Promise<CodeRow[]> {
  const { data, error } = await db.from("billing_pilot_codes").select(COLUMNS).order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read pilot codes: ${error.message}`);
  return (data ?? []) as CodeRow[];
}

/** A code named by `--code` (hashed here) or by `--ref`, the first characters of its hash from `list`. */
export async function findPilotCode(db: SupabaseClient, by: { code?: string; ref?: string }): Promise<CodeRow | null> {
  if (by.code) {
    const normalised = normalisePilotCode(by.code);
    if (!normalised) throw new Error("That is not a pilot code: letters, digits and dashes, 8 to 64 characters.");
    return byHash(db, hashPilotCode(normalised));
  }
  const ref = (by.ref ?? "").toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(ref)) throw new Error("--ref takes the 8-character reference that `list` prints.");
  const matches = (await listPilotCodes(db)).filter((r) => r.code_hash.startsWith(ref));
  if (matches.length > 1) throw new Error(`--ref ${ref} matches ${matches.length} codes; give more characters.`);
  return matches[0] ?? null;
}

// ------------------------------------------------------------------ the codes file

/** The repository this script belongs to, and the git work tree the shell is in, if any. */
export function repositoryRoots(): string[] {
  const roots = new Set<string>([realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."))]);
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (top) roots.add(realpathSync(top));
  } catch {
    // Not inside a git work tree: the script's own repository is still checked.
  }
  return [...roots];
}

/**
 * Whether `file` is inside `root` once both are resolved through symbolic links — a codes file
 * there could be committed to a public repository by accident. A file that does not exist is
 * judged by its directory.
 */
export function insideDirectory(file: string, root: string): boolean {
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      const parent = dirname(p);
      return parent === p ? p : resolve(real(parent), basename(p));
    }
  };
  const f = real(resolve(file));
  const r = real(resolve(root));
  return f === r || f.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function refuseInsideRepository(file: string, roots = repositoryRoots()): void {
  const inside = roots.find((root) => insideDirectory(file, root));
  if (inside) {
    fail(`Refusing ${file}: it is inside the repository working tree (${inside}), where a codes file could be committed. Keep it outside, for example in your home directory.`);
  }
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) fail(`${file} is not a file.`);
    size = st.size;
  } catch {
    fail(`Cannot read ${file}.`);
  }
  if (size > 1_000_000) fail(`${file} is larger than 1 MB; a codes file is a few lines.`);
}

export interface CsvCode { line: number; code: string; runs?: string; days?: string; label: string }

/** RFC 4180 fields: commas, quotes doubled inside quoted fields, CRLF or LF. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("The file ends inside a quoted field.");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * `code,runs,days,label`, one code per line; a header line naming those columns is optional; an
 * empty runs or days takes the default (50, 30). A malformed line stops the whole file before
 * anything is written, naming the line but never echoing its code.
 */
export function parsePilotCsv(text: string): CsvCode[] {
  const out: CsvCode[] = [];
  const rows = csvRows(text.replace(/^﻿/, ""));
  rows.forEach((cells, i) => {
    const line = i + 1;
    if (cells.every((c) => c.trim() === "")) return;
    if (i === 0 && cells[0]?.trim().toLowerCase() === "code") return;
    if (cells.length !== 4) throw new Error(`Line ${line}: expected 4 columns (code,runs,days,label), found ${cells.length}.`);
    const [code, runs, days, label] = cells.map((c) => c.trim());
    const normalised = normalisePilotCode(code);
    if (!normalised) throw new Error(`Line ${line}: the code is not valid (letters, digits and dashes, 8 to 64 characters).`);
    if (out.some((c) => c.code === normalised)) throw new Error(`Line ${line}: the same code appears twice in the file.`);
    out.push({ line, code: normalised, runs: runs || undefined, days: days || undefined, label });
  });
  return out;
}
