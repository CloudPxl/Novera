import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { checkHealth, gradingLevel, gradingVendorCount, OVERALL_SENTENCE, type HealthProbe } from "../src/lib/observability/health.ts";
import { benignLabel, isBenignDisconnect } from "../src/lib/observability/benign.ts";
import { captureError } from "../src/lib/observability/capture.ts";
import { windowLimiter } from "../src/lib/observability/limiter.ts";
import { scrubText } from "../src/lib/observability/scrub.ts";
import {
  EXPECTED_SUITES, INTEGRATION_GUIDES, MIGRATION_PROBES, diskLaunchFiles, launchExitCode, runLaunchChecks,
  type LaunchDb, type LaunchFiles,
} from "../src/lib/readiness/launch-checks.ts";
import { readRepoDoc } from "../src/lib/readiness/repo-docs.ts";
import sitemap from "../src/app/sitemap.ts";
import { GLOSSARY } from "../src/lib/explainability/glossary.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

/** Secrets assembled at run time so no key-shaped literal sits in the repository. */
const SECRETS = {
  groq: ["gsk", "G".repeat(40)].join("_"),
  mistral: "M".repeat(32),
  service: ["eyJ", "a".repeat(30), ".", "b".repeat(30), ".", "c".repeat(30)].join(""),
  stripe: ["sk", "live", "S".repeat(30)].join("_"),
  webhook: ["whsec", "W".repeat(30)].join("_"),
  resend: ["re", "R".repeat(8), "T".repeat(24)].join("_"),
};
const FAKE_ENV = {
  GROQ_API_KEY: SECRETS.groq,
  MISTRAL_API_KEY: SECRETS.mistral,
  SUPABASE_SERVICE_ROLE_KEY: SECRETS.service,
  NEXT_PUBLIC_SUPABASE_URL: "https://secretproject.supabase.co",
  STRIPE_SECRET_KEY: SECRETS.stripe,
  STRIPE_WEBHOOK_SECRET: SECRETS.webhook,
  RESEND_API_KEY: SECRETS.resend,
};

const probe = (over: Partial<HealthProbe> = {}): HealthProbe => ({
  databaseReachable: async () => true,
  runStalled: async () => false,
  ...over,
});

// ------------------------------------------------------------------ M3: health

test("the health report has exactly the agreed keys and carries nothing from the environment", async () => {
  const report = await checkHealth({ probe: probe(), env: FAKE_ENV });
  assert.deepEqual(Object.keys(report).sort(), ["app", "checked_at", "checks", "database", "status"]);
  assert.deepEqual(Object.keys(report.checks).sort(), ["database", "grading", "runner"]);
  assert.deepEqual(Object.keys(report.checks.database).sort(), ["latency_ms", "status"]);
  assert.deepEqual(Object.keys(report.checks.runner), ["status"]);
  assert.deepEqual(Object.keys(report.checks.grading), ["status"]);
  assert.equal(report.app, true);
  assert.equal(report.database, true);
  assert.match(report.checked_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(Number.isInteger(report.checks.database.latency_ms), true);
  const text = JSON.stringify(report);
  for (const [name, value] of [...Object.entries(SECRETS), ...Object.entries(FAKE_ENV)]) {
    assert.ok(!text.includes(value), `${name} leaked into the health report`);
  }
  for (const word of ["groq", "mistral", "supabase", "runs", "run_cases", "stripe", "error", "stack"]) {
    assert.ok(!text.toLowerCase().includes(word), `"${word}" appears in the health report`);
  }
});

test("an unreachable database is down and the runner cannot be checked; a failing probe never throws", async () => {
  for (const databaseReachable of [async () => false, async () => { throw new Error(`boom ${SECRETS.stripe}`); }]) {
    const report = await checkHealth({ probe: probe({ databaseReachable }), env: FAKE_ENV });
    assert.equal(report.status, "down");
    assert.equal(report.database, false);
    assert.equal(report.checks.database.status, "down");
    assert.equal(report.checks.runner.status, "down");
    assert.ok(!JSON.stringify(report).includes(SECRETS.stripe));
  }
});

test("status is ok only when database, runner and grading are all ok; otherwise degraded, never down", async () => {
  const ok = await checkHealth({ probe: probe(), env: FAKE_ENV });
  assert.equal(ok.status, "ok");
  assert.equal(OVERALL_SENTENCE[ok.status], "All systems operational");

  const stalled = await checkHealth({ probe: probe({ runStalled: async () => true }), env: FAKE_ENV });
  assert.equal(stalled.status, "degraded");
  assert.equal(stalled.checks.runner.status, "degraded");
  assert.equal(stalled.database, true, "a degraded platform still answers 200");

  const unreadable = await checkHealth({ probe: probe({ runStalled: async () => { throw new Error("cases unreadable"); } }), env: FAKE_ENV });
  assert.equal(unreadable.checks.runner.status, "degraded", "an unanswered question is not a green light");

  const oneVendor = await checkHealth({ probe: probe(), env: { GROQ_API_KEY: SECRETS.groq } });
  assert.equal(oneVendor.status, "degraded");
  assert.equal(oneVendor.checks.grading.status, "degraded");
  assert.deepEqual(Object.keys(oneVendor.checks.grading), ["status"], "the number of vendors is not published");

  assert.equal(OVERALL_SENTENCE.degraded, "Partial degradation");
  assert.equal(OVERALL_SENTENCE.down, "Service disruption");
});

test("grading counts distinct vendors the judge route can use, from key presence only", () => {
  assert.equal(gradingVendorCount({}), 0);
  assert.equal(gradingVendorCount({ GROQ_API_KEY: "x" }), 1);
  assert.equal(gradingVendorCount({ GROQ_API_KEY: "x", MISTRAL_API_KEY: "y" }), 2);
  // OpenRouter and Google hold keys but are not in the judge route, so they are not grading vendors.
  assert.equal(gradingVendorCount({ GROQ_API_KEY: "x", OPENROUTER_API_KEY: "y", JUDGE_FREE_API_KEY: "z" }), 1);
  assert.equal(gradingLevel({ GROQ_API_KEY: "x", MISTRAL_API_KEY: "y" }), "ok");
  assert.equal(gradingLevel({ GROQ_API_KEY: "x" }), "degraded");
});

test("the health route and the status page use the one check, never expose a count, and keep the 503 rule", () => {
  const route = readFileSync("src/app/api/health/route.ts", "utf8");
  assert.match(route, /getHealth\(\)/);
  assert.match(route, /report\.database \? 200 : 503/);
  assert.match(route, /no-store/);
  const page = readFileSync("src/app/status/page.tsx", "utf8");
  assert.match(page, /getHealth\(\)/);
  for (const sentence of ["Web application and public verification", "Database and evidence storage", "Evaluation runner", "Multi-vendor grading", "eu-central-1"]) {
    assert.ok(page.includes(sentence), sentence);
  }
  assert.match(page, /ExplainTrigger id="status_scope"/);
  assert.doesNotMatch(page, /\b(?:uptime of|SLA|99\.\d)/i);
});

test("the explanation of Novera's status versus the customer's agent is in the glossary and passes the language rule", () => {
  const entry = GLOSSARY.status_scope;
  assert.equal(entry.id, "status_scope");
  assert.match(entry.whatItMeans, /your agent/);
  assert.match(entry.whatItMeans, /case error, never as a failure/);
  assert.deepEqual(scanCustomerLanguage([entry.title, entry.whatItMeans, entry.whyItMatters, entry.nextAction].join("\n")), []);
});

test("/status is in the sitemap and linked from the public footers", () => {
  assert.ok(sitemap().some((e) => e.url.endsWith("/status")));
  for (const file of ["src/app/page.tsx", "src/app/solutions/_components/solution-ui.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /\["Status", "\/status"\]/, file);
  }
});

// ------------------------------------------------------------------ M4: observability

test("client disconnects are recognised by name, code and message, through cause", () => {
  const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  assert.equal(isBenignDisconnect(abort), true);
  assert.equal(isBenignDisconnect(new Error("The destination stream errored while writing data.")), true);
  assert.equal(isBenignDisconnect(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(isBenignDisconnect(Object.assign(new Error("whatever"), { code: "ERR_STREAM_PREMATURE_CLOSE" })), true);
  assert.equal(isBenignDisconnect(new Error("Premature close")), true);
  assert.equal(isBenignDisconnect(new Error("aborted")), true);
  assert.equal(isBenignDisconnect(new Error("outer", { cause: Object.assign(new Error("inner"), { code: "ECONNRESET" }) })), true);
  assert.equal(benignLabel(Object.assign(new Error(`secret ${SECRETS.stripe}`), { code: "ECONNRESET" })), "Error ECONNRESET", "a label never carries the message");
});

test("genuine errors are not mistaken for a disconnect", () => {
  for (const error of [
    new Error("The operation was aborted due to timeout"),
    Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
    new Error("run aborted: three agent errors in a row"),
    new Error("current transaction is aborted, commands ignored until end of transaction block"),
    new TypeError("Cannot read properties of undefined"),
    "aborted by me",
    null,
    undefined,
  ]) assert.equal(isBenignDisconnect(error), false, String(error));
});

/** Runs `fn` with console.error and console.debug captured. */
async function captured(fn: () => Promise<unknown>): Promise<{ errors: string[]; debug: string[] }> {
  const errors: string[] = [];
  const debug: string[] = [];
  const [e, d] = [console.error, console.debug];
  console.error = (...a: unknown[]) => { errors.push(a.join(" ")); };
  console.debug = (...a: unknown[]) => { debug.push(a.join(" ")); };
  try { await fn(); } finally { console.error = e; console.debug = d; }
  return { errors, debug };
}

test("a disconnect is never an error line and never reaches a vendor; at most a one-line debug", async () => {
  const out = await captured(async () => {
    const event = await captureError(new Error("The destination stream errored while writing data."), { request: { method: "GET", path: "/runs/x", headers: {} } });
    assert.equal(event, null);
  });
  assert.deepEqual(out.errors, []);
  assert.ok(out.debug.length <= 1);
  assert.ok(out.debug.every((l) => !l.includes("[novera:error]") && !l.includes("destination stream")));
});

test("a genuine error is reported once, with keys and bearer tokens redacted", async () => {
  const out = await captured(async () => {
    const event = await captureError(
      new Error(`provider refused ${["nvk", "N".repeat(24)].join("_")} and ${["sk", "S".repeat(24)].join("-")} with Authorization: Bearer abc123 and Bearer short1`),
      { request: { method: "POST", path: "/api/v1/runs", headers: { authorization: "Bearer topsecrettoken123" } } },
    );
    assert.ok(event);
  });
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /^\[novera:error\] /);
  for (const leaked of ["NNNNNNNN", "SSSSSSSS", "abc123", "short1", "topsecrettoken123"]) assert.ok(!out.errors[0].includes(leaked), leaked);
});

test("the scrubber covers short bearer tokens, Supabase and Resend keys, and content written after a label", () => {
  assert.equal(scrubText("sent Bearer abc to the api"), "sent Bearer [REDACTED] to the api");
  assert.ok(!scrubText(`key ${["sb", "secret", "x".repeat(20)].join("_")} rejected`).includes("xxxxxxxx"));
  assert.ok(!scrubText(`mail failed for ${SECRETS.resend}`).includes("RRRRRRRR"));
  assert.ok(!scrubText(`x-api-key: ${["nvk", "k".repeat(20)].join("_")}`).includes("kkkkkkkk"));
  assert.ok(!scrubText(`cookie: sb-ref-auth-token=abc.def`).includes("abc.def"));
  assert.ok(!scrubText(`jwt ${SECRETS.service} expired`).includes("aaaaaaaaaa"));
  assert.ok(!scrubText(`stripe ${SECRETS.stripe}`).includes("SSSSSSSS"));
  assert.ok(!scrubText(`signing ${SECRETS.webhook}`).includes("WWWWWWWW"));
  assert.equal(scrubText("agent reply: Of course, here is the customer's full account export you asked for."), "agent reply: [REDACTED_TEXT]");
  assert.equal(scrubText("transcript=I want to cancel my subscription and also delete everything you hold"), "transcript=[REDACTED_TEXT]");
  assert.equal(scrubText("reply: 503"), "reply: 503", "a short status next to the label is kept");
});

test("the vendor limiter allows its quota in a window, then refuses, then resets", () => {
  const allow = windowLimiter(3, 60_000);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => allow(1_000 + i)), [true, true, true, false, false]);
  assert.equal(allow(1_000 + 60_001), true, "a new window opens");
  const source = readFileSync("src/lib/observability/capture.ts", "utf8");
  assert.match(source, /VENDOR_SENDS_PER_MINUTE = 30/);
  assert.match(source, /windowLimiter\(VENDOR_SENDS_PER_MINUTE, 60_000\)/);
});

// ------------------------------------------------------------------ M5: launch checks

const GOOD_DB: LaunchDb = {
  reachable: async () => true,
  objectExists: async () => true,
  builtInSuites: async () => EXPECTED_SUITES.map((s) => ({ ...s })),
  docPages: async () => [
    ...INTEGRATION_GUIDES.map((slug) => ({ slug, published: true })),
    { slug: "what-novera-does", published: true },
  ],
};
const FILES: LaunchFiles = {
  migrations: async () => ["0001_init.sql", "0072_scenario_checks.sql"],
  docs: async () => [...INTEGRATION_GUIDES, "what-novera-does"].map((s) => `${s}.md`),
};
const RESEND_OK = { status: "verified" as const, detail: "The key works and nover.space is verified at Resend.", checkedAt: 0 };
const READY_ENV = { ...FAKE_ENV, RESEND_FROM_EMAIL: "no-reply@nover.space", GROQ_API_KEY: "x", MISTRAL_API_KEY: "y", STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined };

test("with everything in place the platform checks pass and the exit code is 0", async () => {
  const checks = await runLaunchChecks({ resend: RESEND_OK, db: GOOD_DB, files: FILES, env: READY_ENV });
  assert.deepEqual(checks.filter((c) => c.group === "platform").map((c) => c.status), ["pass", "pass", "pass", "pass", "pass", "pass", "pass"]);
  assert.equal(launchExitCode(checks), 0);
  assert.equal(launchExitCode(checks, true), 1, "strict also counts what waits on the founder (company details are all null)");
  assert.ok(checks.every((c) => c.status !== "fail" || c.remediation));
});

test("each failing check names the command or page that fixes it", async () => {
  const bad: LaunchDb = {
    ...GOOD_DB,
    objectExists: async (table) => table !== "ci_triggers",
    builtInSuites: async () => EXPECTED_SUITES.filter((s) => s.key !== "fintech-kyc"),
    docPages: async () => [{ slug: "what-novera-does", published: true }],
  };
  const checks = await runLaunchChecks({ resend: RESEND_OK, db: bad, files: FILES, env: { GROQ_API_KEY: "x" } });
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by.migrations.status, "fail");
  assert.equal(by.migrations.remediation, "npm run migrate");
  assert.match(by.migrations.detail, /0070/);
  assert.match(by.migrations.detail, /Inferred/);
  assert.equal(by.suites.remediation, "npm run seed:suites");
  assert.match(by.suites.detail, /fintech-kyc v2/);
  assert.equal(by.docs.remediation, "npm run seed:docs");
  assert.match(by.docs.detail, /integration-github-actions/);
  assert.equal(by.grading.status, "fail");
  assert.match(by.grading.remediation!, /third-vendor\.md/);
  assert.equal(by.email.status, "pending");
  assert.match(by.email.remediation!, /sign-in-and-email\.md/);
  assert.equal(by.entity.status, "pending");
  assert.equal(launchExitCode(checks), 1);
});

test("a migration newer than every probe is flagged rather than assumed applied", async () => {
  const checks = await runLaunchChecks({ resend: RESEND_OK,
    db: GOOD_DB, env: READY_ENV,
    files: { ...FILES, migrations: async () => ["0072_scenario_checks.sql", "0099_future.sql"] },
  });
  const m = checks.find((c) => c.id === "migrations")!;
  assert.equal(m.status, "fail");
  assert.match(m.detail, /0099/);
  assert.equal(m.remediation, "npm run migrate -- --check");
});

test("a database that does not answer fails every dependent check and never throws", async () => {
  const down: LaunchDb = { ...GOOD_DB, reachable: async () => false };
  const checks = await runLaunchChecks({ resend: RESEND_OK, db: down, files: FILES, env: READY_ENV });
  assert.equal(checks.find((c) => c.id === "database")!.status, "fail");
  for (const id of ["migrations", "suites", "docs"]) assert.match(checks.find((c) => c.id === id)!.detail, /Not checked/);
  const throwing: LaunchDb = { ...GOOD_DB, builtInSuites: async () => { throw new Error(`boom ${SECRETS.stripe}`); } };
  const again = await runLaunchChecks({ resend: RESEND_OK, db: throwing, files: FILES, env: READY_ENV });
  const suites = again.find((c) => c.id === "suites")!;
  assert.equal(suites.status, "fail");
  assert.ok(!JSON.stringify(again).includes(SECRETS.stripe));
});

test("Stripe isolation: off passes, a test key on production fails, test and live modes are named", async () => {
  const run = async (env: Record<string, string | undefined>) =>
    (await runLaunchChecks({ resend: RESEND_OK, db: GOOD_DB, files: FILES, env })).find((c) => c.id === "stripe")!;
  assert.equal((await run({})).status, "pass");
  const testKey = ["sk", "test", "T".repeat(24)].join("_");
  assert.match((await run({ STRIPE_SECRET_KEY: testKey, STRIPE_WEBHOOK_SECRET: SECRETS.webhook })).detail, /Test mode/);
  const onProduction = await run({ STRIPE_SECRET_KEY: testKey, STRIPE_WEBHOOK_SECRET: SECRETS.webhook, VERCEL_ENV: "production" });
  assert.equal(onProduction.status, "fail");
  const unapprovedLive = await run({ STRIPE_SECRET_KEY: SECRETS.stripe, STRIPE_WEBHOOK_SECRET: SECRETS.webhook });
  assert.equal(unapprovedLive.status, "fail");
  for (const c of [onProduction, unapprovedLive]) {
    assert.ok(!JSON.stringify(c).includes(SECRETS.stripe) && !JSON.stringify(c).includes(testKey), "no key value in the row");
  }
});

test("no check carries a configuration value", async () => {
  const checks = await runLaunchChecks({ resend: RESEND_OK, db: GOOD_DB, files: FILES, env: FAKE_ENV });
  const text = JSON.stringify(checks);
  for (const [name, value] of Object.entries(FAKE_ENV)) assert.ok(!text.includes(value), `${name} appears in a launch check`);
});

test("the expected built-in suites are files in data/suites", () => {
  for (const s of EXPECTED_SUITES) assert.ok(existsSync(`data/suites/${s.key}-v${s.version}.json`), `${s.key} v${s.version}`);
  for (const g of INTEGRATION_GUIDES) assert.ok(existsSync(`data/docs/${g}.md`), g);
});

test("every probe names a migration file that exists", () => {
  const files = readdirSync("supabase/migrations");
  for (const p of MIGRATION_PROBES) assert.ok(files.some((f) => f.startsWith(`${p.migration}_`)), p.migration);
});

test("a missing repository file or directory is 'not available here', never a crash", async () => {
  assert.equal(await readRepoDoc("launch", "/nonexistent-root"), null);
  const none = diskLaunchFiles("/nonexistent-root");
  assert.equal(await none.migrations(), null);
  assert.equal(await none.docs(), null);
  const checks = await runLaunchChecks({ resend: RESEND_OK, db: GOOD_DB, files: none, env: READY_ENV });
  const migrations = checks.find((c) => c.id === "migrations")!;
  const docs = checks.find((c) => c.id === "docs")!;
  assert.equal(migrations.status, "pass");
  assert.match(migrations.detail, /migration files not available in this deployment/);
  assert.match(docs.detail, /data\/docs not available in this deployment/);
});

test("the Resend key check: verified, send-only, revoked, unverified domain, cached five minutes, never the key", async () => {
  const { classifyResendDomains, resendHealth, resetResendHealthCache, RESEND_HEALTH_TTL_MS } = await import("../src/lib/mail/resend-health.ts");
  const { emailKeyRow } = await import("../src/lib/readiness/launch-checks.ts");
  assert.equal(classifyResendDomains(200, { data: [{ name: "nover.space", status: "verified" }] }).status, "verified");
  assert.equal(classifyResendDomains(200, { data: [{ name: "nover.space", status: "pending" }] }).status, "domain_unverified");
  assert.equal(classifyResendDomains(200, { data: [] }).status, "domain_missing");
  assert.equal(classifyResendDomains(401, { name: "restricted_api_key" }).status, "send_only", "a sending-only key works");
  assert.equal(classifyResendDomains(401, { name: "missing_api_key" }).status, "invalid_key");
  assert.equal(classifyResendDomains(400, { name: "validation_error" }).status, "invalid_key");
  assert.equal(emailKeyRow({ status: "invalid_key", detail: "x", checkedAt: 0 }).status, "fail");
  assert.equal(emailKeyRow({ status: "send_only", detail: "x", checkedAt: 0 }).status, "pass");
  assert.equal(emailKeyRow({ status: "unconfigured", detail: "x", checkedAt: 0 }).status, "pending");

  resetResendHealthCache();
  let calls = 0;
  let t = 1_000;
  const fake = (async () => { calls++; return new Response(JSON.stringify({ name: "restricted_api_key" }), { status: 401 }); }) as typeof fetch;
  const env = { RESEND_API_KEY: "re_test_never_printed_1234" };
  const first = await resendHealth(env, fake, () => t);
  t += RESEND_HEALTH_TTL_MS - 1;
  await resendHealth(env, fake, () => t);
  assert.equal(calls, 1, "cached within five minutes");
  t += 2;
  await resendHealth(env, fake, () => t);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(first).includes("re_test"), "the key never appears in the answer");
  assert.equal((await resendHealth({}, fake)).status, "unconfigured");
});
