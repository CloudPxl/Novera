#!/usr/bin/env -S node --no-warnings
/**
 * novera — the command line for a sealed Novera report.
 *
 *   novera suite validate <suite.json | suite.csv> [--key k --name n --version v]
 *   novera report verify <link | token | export.json>
 *   novera report status <link | token | export.json> [--junit results.xml]
 *   novera report export <link | token> --format md|csv|json|junit [--out file]
 *   novera run --agent <id> [--suite <id>] [--release <r>] [--kb-revision <k>] [--idempotency-key <k>] [--junit results.xml]   (NOVERA_API_KEY)
 *
 * Exit codes (docs: /docs/cli-and-ci):
 *   0 complete and every scenario passed   1 a scenario failed
 *   2 evidence incomplete, or not verified  3 configuration / authorisation
 *   4 infrastructure (network, server)
 *
 * `run` starts a run with a workspace API key that has the `run` scope, drives it to the
 * end and exits with the sealed report's code. Nothing else here changes anything, and
 * nothing here publishes, revokes or approves.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { validateSuite, suiteFromCsv } from "../src/lib/suites/validate.ts";
import { ciOutcome, CI_EXIT } from "../src/lib/report/ci.ts";
import { reportToJunit, withoutToken } from "../src/lib/report/export.ts";
import {
  DEFAULT_BASE,
  EXPORT_FORMATS,
  describeStatus,
  exitForStatus,
  exportUrl,
  parseTarget,
  redactToken,
  verifyExport,
  type ExportFormat,
  type ReportTarget,
} from "../src/lib/cli/core.ts";

const USAGE = `novera — verify and read sealed Novera reports

  novera suite validate <suite.json | suite.csv> [--key k --name n --version v]
  novera report verify <link | token | export.json> [--offline]
  novera report status <link | token | export.json> [--junit results.xml]
  novera report export <link | token> --format md|csv|json|junit [--out file]
  novera run --agent <id> [--suite <id>] [--release <r>] [--kb-revision <k>] [--idempotency-key <k>] [--junit results.xml]

run needs NOVERA_API_KEY: a workspace key with the "can also start runs" scope. It is
read from the environment only — never pass a key as an argument.

A saved export.json is checked twice: that it is intact, and that it is the report
still served at its link. --offline skips the second check.

Options:  --base <url>  where a bare token is looked up (default ${DEFAULT_BASE}, or NOVERA_URL)

Exit codes: 0 complete and passed · 1 a scenario failed · 2 evidence incomplete or not verified
            3 configuration or authorisation · 4 network or server`;

class Exit extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const SWITCHES = new Set(["offline"]);

function flags(args: string[]): { positional: string[]; opts: Record<string, string> } {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split("=", 2);
      if (SWITCHES.has(name)) {
        opts[name] = "true";
        continue;
      }
      const value = inline ?? args[i + 1];
      if (value === undefined || (inline === undefined && value.startsWith("--"))) {
        throw new Exit(CI_EXIT.configuration, `--${name} needs a value.`);
      }
      opts[name] = value;
      if (inline === undefined) i++;
    } else positional.push(a);
  }
  return { positional, opts };
}

function target(arg: string | undefined, opts: Record<string, string>): ReportTarget {
  if (!arg) throw new Exit(CI_EXIT.configuration, "Pass a report link or token.");
  const parsed = parseTarget(arg, opts.base ?? process.env.NOVERA_URL ?? DEFAULT_BASE);
  if ("error" in parsed) throw new Exit(CI_EXIT.configuration, parsed.error);
  return parsed;
}

async function fetchExport(t: ReportTarget, format: ExportFormat): Promise<string> {
  let response: Response;
  try {
    response = await fetch(exportUrl(t, format), { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Exit(CI_EXIT.infrastructure, `Could not reach ${t.base}: ${e instanceof Error ? e.message : e}`);
  }
  if (!response.ok) throw new Exit(exitForStatus(response.status), describeStatus(response.status));
  return response.text();
}

function isLocalFile(arg: string): boolean {
  return extname(arg).toLowerCase() === ".json" && !/^https?:\/\//i.test(arg);
}

/** A verified export, from a file or from the server. A file is also checked against the server copy. */
async function loadVerified(arg: string | undefined, opts: Record<string, string>) {
  if (arg && isLocalFile(arg)) {
    let raw: string;
    try {
      raw = await readFile(arg, "utf8");
    } catch {
      throw new Exit(CI_EXIT.configuration, `Cannot read ${arg}.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Exit(CI_EXIT.configuration, `${arg} is not JSON.`);
    }
    const local = verifyExport(parsed);
    if (!local.ok) throw new Exit(local.code, local.message);
    if (opts.offline === "true" || !local.url) {
      return { ...local, source: `${basename(arg)} (checked offline: intact, not compared with the original)` };
    }
    // Intact is not the same as genuine: whoever made the file could have hashed their
    // own payload. The original is the one Novera still serves at the link.
    const remote = verifyExport(JSON.parse(await fetchExport(target(local.url, opts), "json")));
    if (!remote.ok) throw new Exit(remote.code, `The original could not be verified: ${remote.message}`);
    if (remote.hash !== local.hash) {
      throw new Exit(CI_EXIT.incomplete, `NOT VERIFIED. This file is intact but is not the report at its link (${local.hash} vs ${remote.hash}).`);
    }
    return { ...local, source: `${basename(arg)}, matched against the original` };
  }
  const t = target(arg, opts);
  const remote = verifyExport(JSON.parse(await fetchExport(t, "json")));
  if (!remote.ok) throw new Exit(remote.code, remote.message);
  return { ...remote, source: `${t.base}/report/${redactToken(t.token)}` };
}

async function suiteValidate(args: string[]): Promise<number> {
  const { positional, opts } = flags(args);
  const file = positional[0];
  if (!file) throw new Exit(CI_EXIT.configuration, "Pass a suite file (.json or .csv).");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Exit(CI_EXIT.configuration, `Cannot read ${file}.`);
  }
  let result;
  if (extname(file).toLowerCase() === ".csv") {
    const version = Number(opts.version ?? 1);
    result = suiteFromCsv(raw, {
      key: opts.key ?? basename(file, extname(file)),
      name: opts.name ?? basename(file, extname(file)),
      version: Number.isInteger(version) && version > 0 ? version : NaN,
    });
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Exit(CI_EXIT.configuration, `${file} is not valid JSON: ${e instanceof Error ? e.message : e}`);
    }
    result = validateSuite(parsed);
  }
  if (!result.ok) {
    console.error(`${file}: ${result.errors.length} problem${result.errors.length === 1 ? "" : "s"}`);
    for (const e of result.errors) console.error(`  - ${e}`);
    return CI_EXIT.configuration;
  }
  const s = result.suite;
  console.log(`${file}: valid — ${s.name} v${s.version}, ${s.cases.length} scenarios.`);
  return 0;
}

async function reportVerify(args: string[]): Promise<number> {
  const { positional, opts } = flags(args);
  const v = await loadVerified(positional[0], opts);
  console.log(`VERIFIED  ${v.hash}`);
  console.log(`          ${v.payload.subject.agent} · ${v.payload.run.suite} · ${v.payload.run.date.slice(0, 10)} · ${v.source}`);
  return 0;
}

async function reportStatus(args: string[]): Promise<number> {
  const { positional, opts } = flags(args);
  const v = await loadVerified(positional[0], opts);
  const p = v.payload;
  const c = p.coverage;
  const outcome = ciOutcome(p);
  console.log(`${p.subject.agent} — ${p.run.suite}, ${p.run.date.slice(0, 16).replace("T", " ")} UTC`);
  console.log(`Grade ${p.grade?.band ?? "not graded"} · ${c.passed} passed · ${c.failed} failed · ${c.errored} no result · ${c.not_run} not run · of ${c.planned}`);
  if (/fixture/i.test(p.subject.environment)) console.log(`Test data: this run was against a fixture (${p.subject.environment}).`);
  console.log(`Verified ${v.hash} (${v.source})`);
  console.log(`${outcome.reason} Exit ${outcome.code}.`);
  if (opts.junit) {
    await writeFile(opts.junit, reportToJunit(p, v.hash, v.url ?? v.source));
    console.log(`JUnit written to ${opts.junit}.`);
  }
  return outcome.code;
}

async function reportExport(args: string[]): Promise<number> {
  const { positional, opts } = flags(args);
  const format = (opts.format ?? "md") as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    throw new Exit(CI_EXIT.configuration, `--format must be one of ${EXPORT_FORMATS.join(", ")}.`);
  }
  const body = await fetchExport(target(positional[0], opts), format);
  if (format === "json") {
    const v = verifyExport(JSON.parse(body));
    if (!v.ok) throw new Exit(v.code, v.message);
  }
  if (opts.out) {
    await writeFile(opts.out, body);
    console.error(`Written to ${opts.out}.`);
  } else process.stdout.write(body);
  return 0;
}

async function api(base: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const key = process.env.NOVERA_API_KEY;
  if (!key) throw new Exit(CI_EXIT.configuration, "Set NOVERA_API_KEY to a workspace API key that can start runs.");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new Exit(CI_EXIT.infrastructure, `Could not reach ${base}: ${e instanceof Error ? e.message : e}`);
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { status: response.status, body };
}

async function runCommand(args: string[]): Promise<number> {
  const { opts } = flags(args);
  const base = (opts.base ?? process.env.NOVERA_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
  if (!opts.agent) throw new Exit(CI_EXIT.configuration, "Pass --agent <id>. GET /api/v1/agents lists them.");

  // A job retried after a timeout should get the run it already started: give the same key
  // on every attempt (the pipeline's run id, say). Without one, each invocation is a new run.
  const idempotencyKey = opts["idempotency-key"] ?? process.env.NOVERA_IDEMPOTENCY_KEY;
  const started = await api(base, "/api/v1/runs", {
    method: "POST",
    ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
    body: JSON.stringify({
      agent_id: opts.agent,
      ...(opts.suite ? { suite_id: opts.suite } : {}),
      // What you are testing, as you state it; the report labels it as declared.
      ...(opts.release ? { release_id: opts.release } : {}),
      ...(opts["kb-revision"] ? { knowledge_base_revision: opts["kb-revision"] } : {}),
    }),
  });
  if (started.status !== 201 && !(started.status === 200 && started.body.replayed === true)) {
    throw new Exit(started.status >= 500 ? CI_EXIT.infrastructure : CI_EXIT.configuration,
      `The run was not started (${started.status}): ${started.body.error ?? "no reason given"}`);
  }
  const runId = (started.body.run as { id: string }).id;
  console.log(`Started run ${runId}.`);

  // Slices of about forty seconds, until the run says it is done. A slice refused
  // because another is still working is waited out, not repeated at once.
  let saidWaiting = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const step = await api(base, `/api/v1/runs/${runId}/execute`, { method: "POST" });
    if (step.status >= 500) throw new Exit(CI_EXIT.infrastructure, `The run stopped: ${step.body.error ?? step.status}`);
    if (step.status !== 200) throw new Exit(CI_EXIT.configuration, `The run could not be advanced (${step.status}): ${step.body.error ?? ""}`);
    if (step.body.done) break;
    if (step.body.started) console.log(`  ${step.body.graded ?? 0} scenarios graded so far…`);
    else {
      if (step.body.waiting === "grading_capacity" && !saidWaiting) {
        console.log("  Waiting for a grading slot: other trial runs are using Novera's shared graders.");
        saidWaiting = true;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  const detail = await api(base, `/api/v1/runs/${runId}`);
  const run = detail.body.run as { status: string; report: { url: string } | null } | undefined;
  if (!run || run.status !== "completed" || !run.report) {
    // No sealed report means no complete evidence: never a pass.
    console.error(`The run ended ${run?.status ?? "unknown"} without a sealed report.`);
    return CI_EXIT.incomplete;
  }
  console.log(`Report: ${withoutToken(run.report.url)}`);
  return reportStatus([run.report.url, ...(opts.junit ? ["--junit", opts.junit] : [])]);
}

async function main(argv: string[]): Promise<number> {
  const [group, command, ...rest] = argv;
  if (!group || group === "help" || group === "--help" || group === "-h") {
    console.log(USAGE);
    return group ? 0 : CI_EXIT.configuration;
  }
  const handlers: Record<string, (a: string[]) => Promise<number>> = {
    "suite validate": suiteValidate,
    "report verify": reportVerify,
    "report status": reportStatus,
    "report export": reportExport,
  };
  if (group === "run") return runCommand([command, ...rest].filter((a): a is string => a !== undefined));
  const handler = handlers[`${group} ${command}`];
  if (!handler) {
    console.error(`Unknown command: ${[group, command].filter(Boolean).join(" ")}\n\n${USAGE}`);
    return CI_EXIT.configuration;
  }
  return handler(rest);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof Exit) {
      console.error(e.message);
      process.exit(e.code);
    }
    // Anything unforeseen is ours, not the report's: never exit 0 or 1 on it.
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(CI_EXIT.infrastructure);
  },
);
