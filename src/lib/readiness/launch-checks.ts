import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { billingConfig, keyMode } from "../billing/config.ts";
import { mailDiagnostics } from "../mail/diagnostics.ts";
import { LEGAL_ENTITY, REQUIRED_ENTITY_FIELDS, missingEntityFields, type LegalEntity } from "../../../data/legal/entity.ts";
import { gradingVendorCount } from "../observability/health.ts";

/**
 * The automated launch checks: what this deployment's database, files and configuration say
 * about being ready, computed on the spot. `/readiness` shows them and `npm run verify:launch`
 * prints them, from this one list, so the page and the command cannot disagree.
 *
 * Read-only. Configuration is reported as present, absent or a mode, never as a value. A check
 * that cannot be answered (a file not in this deployment, a database that did not reply) says so
 * and fails or waits; it is never read as a pass.
 *
 *   pass     the check holds
 *   fail     something is wrong that a command or a setting fixes (remediation says which)
 *   pending  waiting on a person (the founder, counsel), not a fault; `verify:launch --strict`
 *            counts it as a failure, the default does not
 */

export type CheckStatus = "pass" | "fail" | "pending";

export interface LaunchCheck {
  id: string;
  title: string;
  /** `platform` checks are shown under "Automated checks" on /readiness; `founder` ones already have a row under "Founder sign-off". */
  group: "platform" | "founder";
  status: CheckStatus;
  detail: string;
  /** The command or page that resolves it. Null when the check passes. */
  remediation: string | null;
}

/** What the checks need to ask the database. Every method throws when the answer is unknown. */
export interface LaunchDb {
  /** True when a trivial read succeeds. */
  reachable(): Promise<boolean>;
  /** True when `table` has `column` (or the table exists, when `column` is null). */
  objectExists(table: string, column: string | null): Promise<boolean>;
  builtInSuites(): Promise<Array<{ key: string; version: number }>>;
  docPages(): Promise<Array<{ slug: string; published: boolean }>>;
}

/** Names of files in this deployment; null when the directory is not there. */
export interface LaunchFiles {
  migrations(): Promise<string[] | null>;
  docs(): Promise<string[] | null>;
}

export interface LaunchInput {
  db: LaunchDb;
  files?: LaunchFiles;
  env?: Record<string, string | undefined>;
  entity?: LegalEntity;
}

/** The built-in suites a deployment is expected to hold, at their current versions. tests/block6-ops.test.ts checks each file exists. */
export const EXPECTED_SUITES: ReadonlyArray<{ key: string; version: number }> = [
  { key: "eu-support", version: 6 },
  { key: "eu-gdpr-support", version: 2 },
  { key: "e-commerce-refund", version: 1 },
  { key: "fintech-kyc", version: 2 },
];

export const INTEGRATION_GUIDES = ["integration-github-actions", "integration-langgraph-python", "integration-vercel-ai-sdk"] as const;

/**
 * Objects each recent migration created, that the app's role can see. The migration ledger is
 * closed to every API role by design (0045), so "applied" is inferred from these: if the newest
 * migration's table or column is there, so is everything before it, because the runner applies in
 * order. 0069 only added an index (`reports_content_hash_idx`), which the API cannot see, so it
 * has no probe; `npm run migrate -- --check` is the authoritative answer.
 */
export const MIGRATION_PROBES: ReadonlyArray<{ migration: string; table: string; column: string | null }> = [
  { migration: "0067", table: "runs", column: "funded_by_subscription" },
  { migration: "0068", table: "contract_acceptances", column: null },
  { migration: "0070", table: "ci_triggers", column: null },
  { migration: "0071", table: "suites", column: "extends_suite_id" },
  { migration: "0072", table: "case_retests", column: "origin" },
];

const NOT_HERE = "not available in this deployment";

/** Settles a check that may throw into a failing row that says the answer was not available. */
async function guarded(
  base: Pick<LaunchCheck, "id" | "title" | "group">,
  remediation: string,
  body: () => Promise<Pick<LaunchCheck, "status" | "detail" | "remediation">>,
): Promise<LaunchCheck> {
  try {
    return { ...base, ...(await body()) };
  } catch {
    return { ...base, status: "fail", detail: "Could not be read: the database did not answer this question.", remediation };
  }
}

function migrationNumber(file: string): string | null {
  return /^(\d{4})_/.exec(file)?.[1] ?? null;
}

async function migrationsCheck({ db, files }: LaunchInput): Promise<LaunchCheck> {
  const base = { id: "migrations", title: "Migrations applied", group: "platform" as const };
  return guarded(base, "npm run migrate", async () => {
    const results: Array<{ migration: string; present: boolean }> = [];
    for (const p of MIGRATION_PROBES) results.push({ migration: p.migration, present: await db.objectExists(p.table, p.column) });
    const absent = results.filter((r) => !r.present).map((r) => r.migration);
    const names = files ? await files.migrations().catch(() => null) : null;
    const numbers = (names ?? []).map(migrationNumber).filter((n): n is string => n !== null).sort();
    const newestFile = numbers.at(-1) ?? null;
    const newestProbe = MIGRATION_PROBES.at(-1)!.migration;
    const how = "Inferred from objects the newest migrations created, because the ledger is closed to the app by design";
    if (absent.length) {
      return {
        ...base, status: "fail" as const,
        detail: `Not applied: ${absent.join(", ")}. ${how}.`,
        remediation: "npm run migrate",
      };
    }
    if (newestFile && newestFile > newestProbe) {
      return {
        ...base, status: "fail" as const,
        detail: `Objects of ${results.map((r) => r.migration).join(", ")} are present, but the newest migration file is ${newestFile} and nothing here can show it applied. ${how}.`,
        remediation: "npm run migrate -- --check",
      };
    }
    return {
      ...base, status: "pass" as const,
      detail: `${results.length} of ${results.length} probes present, newest ${newestProbe}${newestFile ? `; newest file ${newestFile}` : `; migration files ${NOT_HERE}`}. ${how}.`,
      remediation: null,
    };
  });
}

async function suitesCheck({ db }: LaunchInput): Promise<LaunchCheck> {
  const base = { id: "suites", title: "Built-in suites seeded", group: "platform" as const };
  return guarded(base, "npm run seed:suites", async () => {
    const stored = await db.builtInSuites();
    const missing = EXPECTED_SUITES.filter((e) => !stored.some((s) => s.key === e.key && s.version === e.version));
    if (missing.length) {
      return { ...base, status: "fail" as const, detail: `Missing: ${missing.map((m) => `${m.key} v${m.version}`).join(", ")}.`, remediation: "npm run seed:suites" };
    }
    return { ...base, status: "pass" as const, detail: EXPECTED_SUITES.map((e) => `${e.key} v${e.version}`).join(", ") + ".", remediation: null };
  });
}

async function docsCheck({ db, files }: LaunchInput): Promise<LaunchCheck> {
  const base = { id: "docs", title: "Documentation seeded", group: "platform" as const };
  return guarded(base, "npm run seed:docs", async () => {
    const rows = (await db.docPages()).filter((r) => r.published);
    const slugs = new Set(rows.map((r) => r.slug));
    const names = files ? await files.docs().catch(() => null) : null;
    const expected = names ? names.filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")) : null;
    const missingGuides = INTEGRATION_GUIDES.filter((g) => !slugs.has(g));
    const missingPages = expected ? expected.filter((s) => !slugs.has(s)) : [];
    if (missingGuides.length || missingPages.length || rows.length === 0) {
      const parts = [
        rows.length === 0 ? "no published documentation pages" : null,
        missingGuides.length ? `integration guides missing: ${missingGuides.join(", ")}` : null,
        missingPages.length ? `${missingPages.length} page${missingPages.length === 1 ? "" : "s"} in data/docs not published` : null,
      ].filter(Boolean);
      return { ...base, status: "fail" as const, detail: `${parts.join("; ")}.`, remediation: "npm run seed:docs" };
    }
    return {
      ...base, status: "pass" as const,
      detail: `${rows.length} published${expected ? ` of ${expected.length} in data/docs` : `; data/docs ${NOT_HERE}`}; the three integration guides are present.`,
      remediation: null,
    };
  });
}

function stripeCheck(env: Record<string, string | undefined>): LaunchCheck {
  const base = { id: "stripe", title: "Stripe mode isolation", group: "platform" as const };
  const secret = env.STRIPE_SECRET_KEY?.trim();
  const config = billingConfig(env);
  const fix = "docs/BILLING-DECISIONS.md";
  if (!secret) {
    return { ...base, status: "pass", detail: "Billing is off here: no Stripe key is configured, so nothing can be bought and no mode needs isolating.", remediation: null };
  }
  if (!config.active) {
    return { ...base, status: "fail", detail: `${secret && keyMode(secret) ? `A Stripe ${keyMode(secret)} key is configured` : "A key is configured"}, and billing refuses it: ${config.reason ?? "reason unknown"}`, remediation: fix };
  }
  return {
    ...base, status: "pass",
    detail: config.mode === "live"
      ? "Live mode: this deployment reads only live-mode rows."
      : "Test mode: this deployment reads only test-mode rows, and the production deployment would refuse this key.",
    remediation: null,
  };
}

function gradingCheck(env: Record<string, string | undefined>): LaunchCheck {
  const base = { id: "grading", title: "Two grading vendors configured", group: "platform" as const };
  const n = gradingVendorCount(env);
  return n >= 2
    ? { ...base, status: "pass", detail: `${n} distinct vendors the judge route can use have a key here.`, remediation: null }
    : { ...base, status: "fail", detail: `${n} of the 2 needed. Verdicts are then labelled corroborated within one vendor, or not corroborated.`, remediation: "docs/setup/third-vendor.md" };
}

function emailCheckRow(env: Record<string, string | undefined>): LaunchCheck {
  const base = { id: "email", title: "Email configured", group: "founder" as const };
  const d = mailDiagnostics(env);
  return d.configured
    ? { ...base, status: "pass", detail: "Resend key and sender are present and the sender is on the expected domain. Delivery is proven only by a message arriving.", remediation: null }
    : { ...base, status: "pending", detail: `Resend key ${d.resendKey.present ? "present" : "absent"}, sender ${d.from.present ? "present" : "absent"}${d.problems.length ? `; ${d.problems.length} setting${d.problems.length === 1 ? "" : "s"} to fix` : ""}.`, remediation: "docs/setup/sign-in-and-email.md" };
}

function entityCheckRow(entity: LegalEntity): LaunchCheck {
  const base = { id: "entity", title: "Company details complete", group: "founder" as const };
  const missing = missingEntityFields(entity);
  return missing.length === 0
    ? { ...base, status: "pass", detail: `All ${REQUIRED_ENTITY_FIELDS.length} required fields are filled.`, remediation: null }
    : { ...base, status: "pending", detail: `${REQUIRED_ENTITY_FIELDS.length - missing.length} of ${REQUIRED_ENTITY_FIELDS.length} required fields filled. Live checkout is refused until every one is.`, remediation: "data/legal/entity.ts (docs/legal-inputs-required.md)" };
}

/** Every automated check, in the order they are shown. */
export async function runLaunchChecks(input: LaunchInput): Promise<LaunchCheck[]> {
  const env = input.env ?? process.env;
  const database = await guarded(
    { id: "database", title: "Database reachable", group: "platform" },
    "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (docs/setup/status.md)",
    async () => {
      const ok = await input.db.reachable();
      return ok
        ? { status: "pass" as const, detail: "Answered.", remediation: null }
        : { status: "fail" as const, detail: "Did not answer.", remediation: "Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (docs/setup/status.md)" };
    },
  );
  // Without a database the rest cannot be answered; say so once per check rather than guess.
  const rest = database.status === "pass"
    ? [await migrationsCheck(input), await suitesCheck(input), await docsCheck(input)]
    : [
        { id: "migrations", title: "Migrations applied", group: "platform" as const },
        { id: "suites", title: "Built-in suites seeded", group: "platform" as const },
        { id: "docs", title: "Documentation seeded", group: "platform" as const },
      ].map((b): LaunchCheck => ({ ...b, status: "fail", detail: "Not checked: the database did not answer.", remediation: database.remediation }));
  return [
    database,
    ...rest,
    gradingCheck(env),
    stripeCheck(env),
    emailCheckRow(env),
    entityCheckRow(input.entity ?? LEGAL_ENTITY),
  ];
}

/** Process exit code: 0 when nothing failed (and, with `strict`, nothing is pending either). */
export function launchExitCode(checks: readonly LaunchCheck[], strict = false): 0 | 1 {
  return checks.some((c) => c.status === "fail" || (strict && c.status === "pending")) ? 1 : 0;
}

// ------------------------------------------------------------------ the real inputs

/** The checks' view of the database, through the service client (read-only: selects only). */
export async function supabaseLaunchDb(): Promise<LaunchDb> {
  const { serviceClient } = await import("../supabase/service.ts");
  const db = serviceClient();
  const MISSING = new Set(["42703", "42P01", "PGRST204", "PGRST205"]);
  return {
    async reachable() {
      const { error } = await db.from("suites").select("id", { count: "exact", head: true }).is("workspace_id", null).abortSignal(AbortSignal.timeout(5_000));
      return !error;
    },
    async objectExists(table, column) {
      const { error } = await db.from(table).select(column ?? "*", { head: true, count: "exact" }).limit(1).abortSignal(AbortSignal.timeout(5_000));
      if (!error) return true;
      if (MISSING.has(error.code)) return false;
      throw new Error("unknown");
    },
    async builtInSuites() {
      const { data, error } = await db.from("suites").select("key, version").is("workspace_id", null).abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("unknown");
      return (data ?? []) as Array<{ key: string; version: number }>;
    },
    async docPages() {
      const { data, error } = await db.from("doc_pages").select("slug, published").abortSignal(AbortSignal.timeout(5_000));
      if (error) throw new Error("unknown");
      return (data ?? []) as Array<{ slug: string; published: boolean }>;
    },
  };
}

/** Directory listings from the working directory; null when a directory is not in this deployment. */
export function diskLaunchFiles(root: string = process.cwd()): LaunchFiles {
  const list = (dir: string) => async () => {
    try {
      return await readdir(join(root, dir));
    } catch {
      return null;
    }
  };
  return { migrations: list("supabase/migrations"), docs: list("data/docs") };
}
