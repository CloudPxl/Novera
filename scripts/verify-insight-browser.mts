/**
 * verify:insight-browser — the browser worker, end to end, on this machine.
 *
 * Real Chromium (the installed Google Chrome), the real worker bundle (workers/insight-browser/
 * dist/worker.mjs, spawned as its own process with its own environment), and the real server
 * handlers (`claimForWorker`, `handleWorkerEvent`) behind a local HTTP server that also serves
 * Novera's scripted chat widget (src/lib/insight/fixture-widget.ts) and a robots.txt. The store is
 * in memory (tests/helpers/insight-fake-db.ts) and the AI graders are a fixed rule, so nothing
 * leaves this machine and no model is called. The database's own rules (append-only, forward-only,
 * one active scan) are proved by tests/insight-migration.test.ts and on a real database.
 *
 * Proves: a scan of the plain widget records six observations, at least the pacing apart, each in
 * a fresh session, with no echo or typing indicator in a reply; the iframe, shadow-root and
 * launcher-behind-a-cookie-banner widgets are found; a login, a payment field, a bot challenge, a
 * redirect to another site and a page without a widget each end the scan with their kind and send
 * nothing; a login that appears after the first reply ends it after one; a slow reply is captured
 * whole; a silent widget gives a no-reply row, never a verdict; robots.txt refuses a path before any
 * page is opened; a wrong worker secret is refused.
 *
 * Needs Google Chrome installed (NOVERA_INSIGHT_WORKER_CHANNEL=chrome), and about four minutes:
 * the plain scan waits the real pacing between its six prompts.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { claimForWorker } from "../src/lib/insight/claim.ts";
import { handleWorkerEvent } from "../src/lib/insight/events.ts";
import { fixtureCsp, fixtureWidgetPage, isFixtureVariant } from "../src/lib/insight/fixture-widget.ts";
import { INSIGHT_SUITE, INSIGHT_SUITE_DIGEST } from "../src/lib/insight/suite.ts";
import { PACING_MS, parseClaimRequest, parseEventRequest } from "../src/lib/insight/protocol.ts";
import { isWorkerRequest, workerSecret } from "../src/lib/insight/worker-secret.ts";
import type { GradeResult } from "../src/lib/insight/grade.ts";
import type { PendingGrading } from "../src/lib/judge/consensus.ts";
import { fakeInsightDb } from "../tests/helpers/insight-fake-db.ts";

const KEY = randomBytes(32).toString("hex");
// The server seals a deferred grading under the deployment's key; here, the verifier's own.
process.env.NOVERA_ENCRYPTION_KEY = KEY;
const SECRET = workerSecret(KEY);
const WORKER = "verify-local";
const BUNDLE = "workers/insight-browser/dist/worker.mjs";
if (!existsSync(BUNDLE)) throw new Error(`${BUNDLE} is missing: run npm run insight-worker:build.`);

type Row = Record<string, unknown>;
const db = fakeInsightDb({ insight_scans: [], insight_targets: [], insight_observations: [], insight_workers: [] });
const pageLoads = new Map<string, number>();
const sent = new Map<string, number>();
const turnPosts = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * When set, the next grading stops for capacity (a third vendor rate-limited on a tie), as
 * production's T08 did; the resumed grading then settles it.
 */
let deferNextGrading = false;
const TIE: PendingGrading = {
  opinions: [
    { status: "pass", rationale: "a", failedAssertions: [], usage: {}, servedBy: { connection: "fixture", model: "a" }, attempts: [], answered: [{ connection: "fixture", model: "a" }], rawJudgeText: null, error: null },
    { status: "fail", rationale: "b", failedAssertions: [], usage: {}, servedBy: { connection: "other", model: "b" }, attempts: [], answered: [{ connection: "other", model: "b" }], rawJudgeText: null, error: null },
  ],
  asked: [{ connection: "fixture", model: "a" }, { connection: "other", model: "b" }],
  attempts: [{ connection: "third", model: "c", ok: false, ms: 1, reason: "rate_limited" }],
};
const resumedWith: Array<PendingGrading | undefined> = [];

/** The AI graders, as a fixed rule: a reply that adopts the persona fails, everything else passes. */
const grade = async (args: { scenario: { id: string }; responseText: string | null; partial: boolean; resume?: PendingGrading }): Promise<GradeResult> => {
  if (args.responseText === null) return { kind: "ungraded", reason: "no_reply" };
  if (args.partial) return { kind: "ungraded", reason: "partial" };
  resumedWith.push(args.resume);
  if (deferNextGrading) {
    deferNextGrading = false;
    return { kind: "graded", status: "error", rationale: null, failedAssertions: [], judgeModel: null, judgeVotes: [], judgeAgreement: "unresolved", settledBy: "models", error: "Two models disagreed and a third could not settle it.", pending: TIE };
  }
  const fail = /DEVMODE/.test(args.responseText);
  return {
    kind: "graded", status: fail ? "fail" : "pass", rationale: fail ? "Adopted the persona." : "Met the expectation.", failedAssertions: [],
    judgeModel: "fixture/a", judgeVotes: [{ model: "fixture/a", status: fail ? "fail" : "pass", rationale: null }, { model: "other/b", status: fail ? "fail" : "pass", rationale: null }],
    judgeAgreement: "agreed", settledBy: "models", error: null,
  };
};
const deps = {
  chatFor: async () => ({ chat: (async () => { throw new Error("no model in the verifier"); }) as never, funding: "plan_managed" as const, calls: [] }),
  grade: grade as never,
};

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}
const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };

let origin = "";
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("User-agent: *\nDisallow: /blocked/\n");
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/sent/")) { bump(sent, url.pathname.slice(6)); res.writeHead(204).end(); return; }
    const widgetPath = url.pathname === "/widget" || url.pathname === "/blocked/widget";
    if (req.method === "GET" && widgetPath) {
      const variant = url.searchParams.get("variant") ?? "plain";
      const tag = url.searchParams.get("tag") ?? variant;
      if (!isFixtureVariant(variant)) { res.writeHead(404).end(); return; }
      if (url.searchParams.get("framed") !== "1") bump(pageLoads, tag);
      const nonce = randomBytes(16).toString("base64");
      const html = fixtureWidgetPage({
        variant, nonce, framed: url.searchParams.get("framed") === "1",
        // Another host for the same server: the browser leaves the target's site.
        offsiteTo: origin.replace("127.0.0.1", "localhost") + "/widget?variant=plain&tag=offsite-landing",
        sentBeacon: `/sent/${tag}`, selfPath: `${url.pathname}?variant=${variant}&tag=${tag}`,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": fixtureCsp(nonce) });
      res.end(html);
      return;
    }
    if (req.method !== "POST" || !url.pathname.startsWith("/api/internal/insight/")) { res.writeHead(404).end(); return; }
    if (!isWorkerRequest(req.headers.authorization ?? null, KEY)) { json(res, 401, { error: "Not authorised." }); return; }
    if (url.pathname === "/api/internal/insight/claim") {
      const worker = parseClaimRequest(await body(req));
      if ("error" in worker) { json(res, 400, worker); return; }
      // A loopback http address is accepted here only: the deployed claim refuses both.
      json(res, 200, await claimForWorker({ db: db.client, worker, checkAddress: async (raw) => new URL(raw) }));
      return;
    }
    const m = /^\/api\/internal\/insight\/scans\/([^/]+)\/events$/.exec(url.pathname);
    if (m) {
      const parsed = parseEventRequest(await body(req));
      if ("error" in parsed) { json(res, 400, parsed); return; }
      if (parsed.event.kind === "turn") bump(turnPosts, `${m[1]}:${parsed.event.grading_state ? "with-state" : "plain"}`);
      const answer = await handleWorkerEvent({ db: db.client, scanId: m[1], workerId: parsed.worker_id, token: parsed.lease_token, event: parsed.event }, deps);
      json(res, answer.ok ? 200 : answer.status, answer);
      return;
    }
    res.writeHead(404).end();
  } catch (e) {
    json(res, 500, { ok: false, status: 500, error: e instanceof Error ? e.message : String(e), stop: false });
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

function queue(tag: string, path: string, scenarioIds: string[]): string {
  const targetId = `t-${tag}`;
  const scanId = `00000000-0000-4000-8000-${String(db.rows.insight_scans.length + 1).padStart(12, "0")}`;
  db.rows.insight_targets.push({ id: targetId, workspace_id: "w1", name: "Acme Demo", demo_url: `${origin}${path}`, category: "A", do_not_contact: false });
  db.rows.insight_scans.push({
    id: scanId, workspace_id: "w1", target_id: targetId, suite_key: INSIGHT_SUITE.key, suite_version: INSIGHT_SUITE.version,
    suite_digest: INSIGHT_SUITE_DIGEST, scenario_ids: scenarioIds, status: "queued", claimed_by: null, lease_token: null, lease_until: null,
    last_turn_at: null, turns_recorded: 0, robots: null, page: null, error_kind: null, error_detail: null, aborted_reason: null,
    started_by: "u1", started_by_role: "owner", created_at: new Date().toISOString(), finished_at: null,
  });
  return scanId;
}

function runWorker(secret = SECRET): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(process.execPath, [BUNDLE, "--once"], {
      // Only what the worker is documented to read: none of this process's keys reach it.
      env: { NODE_ENV: "production", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NOVERA_BASE_URL: origin, NOVERA_INSIGHT_WORKER_SECRET: secret, NOVERA_INSIGHT_WORKER_ID: WORKER, NOVERA_INSIGHT_WORKER_CHANNEL: "chrome" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr?.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.on("close", (code: number | null) => resolve({ code, out }));
  });
}

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const scanOf = (id: string) => db.rows.insight_scans.find((s) => s.id === id) as Row;
const obsOf = (id: string) => (db.rows.insight_observations ?? []).filter((o) => o.scan_id === id) as Row[];
const ALL = INSIGHT_SUITE.cases.map((c) => c.id);
const started = Date.now();

// 1. A wrong secret is refused, and nothing is claimed.
{
  const id = queue("auth", "/widget?variant=plain&tag=auth", ["P01"]);
  const r = await runWorker("not-the-secret");
  check(r.code === 4 && scanOf(id).status === "queued", "a wrong worker secret is refused and claims nothing", `exit ${r.code}, ${scanOf(id).status}`);
  scanOf(id).status = "aborted"; scanOf(id).aborted_reason = "verifier"; scanOf(id).finished_at = new Date().toISOString();
}

// 2. robots.txt refuses the path before any page is opened.
{
  const id = queue("robots", "/blocked/widget?variant=plain&tag=robots", ["P01"]);
  await runWorker();
  const s = scanOf(id);
  check(s.status === "error" && s.error_kind === "robots_disallowed", "robots.txt: a disallowed path ends the scan at claim", `${s.status}/${s.error_kind}`);
  check(!pageLoads.get("robots"), "robots.txt: no page was opened", `${pageLoads.get("robots")} loads`);
}

// 3. The plain widget, all six scenarios, the real pacing.
{
  const id = queue("plain", "/widget?variant=plain&tag=plain", ALL);
  const r = await runWorker();
  const s = scanOf(id);
  const rows = obsOf(id);
  check(s.status === "graded" && rows.length === 6, "plain: six observations, scan graded", `${s.status}, ${rows.length} rows, exit ${r.code}\n${r.out}`);
  check(pageLoads.get("plain") === 6, "plain: each scenario in a fresh session (six page loads)", `${pageLoads.get("plain")}`);
  check(sent.get("plain") === 6, "plain: six prompts sent, none retried", `${sent.get("plain")}`);
  const times = rows.map((o) => Date.parse(String(o.created_at))).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  check(gaps.every((g) => g >= PACING_MS), `plain: every turn at least ${PACING_MS / 1000} s after the last`, gaps.join(", "));
  const p03 = rows.find((o) => o.scenario_id === "P03");
  check(p03?.status === "fail" && rows.filter((o) => o.status === "pass").length === 5, "plain: P03 fails (the persona), the other five pass", rows.map((o) => `${o.scenario_id}:${o.status}`).join(" "));
  const echo = rows.find((o) => typeof o.response_text === "string" && (String(o.response_text).includes(String(o.prompt_text)) || /typing/i.test(String(o.response_text))));
  check(!echo, "plain: no reply contains its prompt or a typing indicator", echo ? `${echo.scenario_id}: ${String(echo.response_text).slice(0, 120)}` : "");
  const p06 = rows.find((o) => o.scenario_id === "P06");
  check(p06?.response_text === "You're talking to an automated assistant, not a person.", "plain: a reply is captured exactly", String(p06?.response_text));
  const page = s.page as Row | null;
  check(Boolean(page?.widget) && (page!.widget as Row).selector_path === 'textarea[placeholder="Type your message…"]', "plain: the widget and its selector are recorded", JSON.stringify(page?.widget));
  check(!/automated assistant|DEVMODE/.test(r.out), "plain: the worker's log holds no reply text");
  check(((s.robots as Row)?.worker as Row)?.allowed === true && ((s.robots as Row)?.server as Row)?.allowed === true, "plain: robots.txt checked by the server and the worker");
}

// 4. Widgets in a frame, a shadow root, and behind a launcher with a cookie banner.
for (const variant of ["iframe", "shadow", "launcher"] as const) {
  const id = queue(variant, `/widget?variant=${variant}&tag=${variant}`, ["P06"]);
  const r = await runWorker();
  const s = scanOf(id);
  const row = obsOf(id)[0];
  check(s.status === "graded" && row?.status === "pass", `${variant}: the widget is found and the reply graded`, `${s.status}/${s.error_kind} ${row?.status ?? "no row"}\n${r.out}`);
  if (variant === "launcher") check((s.page as Row)?.consent_clicked === true, "launcher: the cookie banner was accepted once");
  if (variant === "iframe") check(String(row?.capture && (row.capture as Row).selector_path).startsWith("frame#"), "iframe: the capture names the frame", JSON.stringify(row?.capture));
  if (variant === "shadow") check(String((row?.capture as Row)?.selector_path).includes("shadow >"), "shadow: the capture names the shadow root", JSON.stringify(row?.capture));
}

// 5. Where the worker stops, sending nothing.
for (const [variant, kind] of [["login", "blocked_login"], ["payment", "blocked_payment"], ["challenge", "blocked_challenge"], ["offsite", "redirected_offsite"], ["none", "widget_not_found"]] as const) {
  const id = queue(variant, `/widget?variant=${variant}&tag=${variant}`, ["P01", "P02"]);
  const r = await runWorker();
  const s = scanOf(id);
  check(s.status === "error" && s.error_kind === kind && obsOf(id).length === 0 && !sent.get(variant), `${variant}: ends as ${kind}, nothing sent`, `${s.status}/${s.error_kind}, ${obsOf(id).length} rows, ${sent.get(variant) ?? 0} sent\n${r.out}`);
}

// 6. A login that appears after the first reply ends the scan after one.
{
  const id = queue("late-login", "/widget?variant=late-login&tag=late-login", ["P01", "P02"]);
  // Each scenario is a fresh session, so the login appears again after the first reply of each; the scan stops after the first.
  await runWorker();
  const s = scanOf(id);
  check(s.status === "error" && s.error_kind === "blocked_login" && obsOf(id).length === 1 && sent.get("late-login") === 1, "late login: one observation, then the scan ends", `${s.status}/${s.error_kind}, ${obsOf(id).length} rows, ${sent.get("late-login")} sent`);
}

// 7. A slow reply is captured whole; a silent widget gives no verdict.
{
  const id = queue("slow", "/widget?variant=slow&tag=slow", ["P06"]);
  await runWorker();
  const row = obsOf(id)[0];
  check(scanOf(id).status === "graded" && row?.response_text === "You're talking to an automated assistant, not a person." && (row.capture as Row).partial === false, "slow: the reply that arrived in three parts is captured whole", JSON.stringify({ text: row?.response_text, capture: row?.capture }));
}
{
  const id = queue("silent", "/widget?variant=silent&tag=silent", ["P06"]);
  await runWorker();
  const row = obsOf(id)[0];
  check(scanOf(id).status === "graded" && row?.status === "error" && row.response_text === null && row.settled_by === null, "silent: a no-reply row, never a verdict", JSON.stringify(row));
}

// 8. A grading stopped for Novera's capacity is resumed from the same reply: the worker posts it
// again with the sealed state after the wait, and never types the prompt to the widget again.
{
  const id = queue("deferred", "/widget?variant=plain&tag=deferred", ["P06"]);
  deferNextGrading = true;
  resumedWith.length = 0;
  await runWorker();
  const rows = obsOf(id);
  check(scanOf(id).status === "graded" && rows.length === 1 && rows[0].status === "pass", "deferred: the reply is graded on the second post and recorded once", `${scanOf(id).status}, ${rows.map((r) => r.status).join(",")}`);
  check(sent.get("deferred") === 1, "deferred: the prompt was typed once, never again", `${sent.get("deferred")} sent`);
  check(turnPosts.get(`${id}:plain`) === 1 && turnPosts.get(`${id}:with-state`) === 1, "deferred: the same turn posted again with the sealed grading", JSON.stringify([turnPosts.get(`${id}:plain`), turnPosts.get(`${id}:with-state`)]));
  check(resumedWith.length === 2 && resumedWith[0] === undefined && resumedWith[1]?.opinions.length === 2, "deferred: the second grading resumed from the opinions already given");
}

server.close();
console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`} in ${Math.round((Date.now() - started) / 1000)} s.`);
process.exit(failures === 0 ? 0 : 1);
