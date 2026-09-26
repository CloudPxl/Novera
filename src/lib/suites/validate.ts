import type { Suite, SuiteCase } from "../runner/types.ts";
import { MAX_EARLIER_TURNS } from "../runner/conversation.ts";
import { MAX_PERSONA_TURNS } from "../simulate/persona.ts";

/**
 * Parses a list of deterministic checks, reporting every problem rather than the
 * first.
 *
 * Shared by a scenario's own `checks` and by `effect.verify.expect`, which are the
 * same vocabulary applied to two different texts — the agent's reply, and the
 * read-back from the customer's system. Two copies of this parser would drift, and
 * the drift would show up as a rule that silently does nothing.
 */
function validateChecks(
  list: unknown[],
  label: string,
  errors: string[],
): NonNullable<SuiteCase["checks"]> | null {
  const before = errors.length;
        const parsed: NonNullable<SuiteCase["checks"]> = [];
        list.forEach((raw: unknown, i: number) => {
          const k = raw as Record<string, unknown>;
          const at = `${label}: check ${i + 1}`;
          const text = (key: string) => (typeof k?.[key] === "string" && (k[key] as string).trim() ? (k[key] as string) : null);
          switch (k?.type) {
            case "must_contain":
            case "must_not_contain": {
              const value = text("value");
              if (!value) errors.push(`${at}: \`value\` must be a non-empty string.`);
              else parsed.push({ type: k.type as "must_contain", value });
              break;
            }
            case "must_match":
            case "must_not_match": {
              const pattern = text("pattern");
              if (!pattern) { errors.push(`${at}: \`pattern\` must be a non-empty string.`); break; }
              try { new RegExp(pattern, "i"); } catch {
                errors.push(`${at}: /${pattern}/ is not a valid regular expression.`); break;
              }
              parsed.push({ type: k.type as "must_match", pattern });
              break;
            }
            case "tools_allowed": {
              const tools = stringList(k.tools);
              if (!tools) errors.push(`${at}: \`tools\` must be a list of non-empty strings.`);
              else parsed.push({ type: "tools_allowed", tools });
              break;
            }
            case "tool_forbidden":
            case "tool_required": {
              const tool = text("tool");
              if (!tool) errors.push(`${at}: \`tool\` must be a non-empty string.`);
              else parsed.push({ type: k.type as "tool_required", tool });
              break;
            }
            case "tool_order": {
              const tools = stringList(k.tools);
              if (!tools || tools.length < 2) {
                errors.push(`${at}: \`tools\` must list at least two tool names to order.`);
              } else parsed.push({ type: "tool_order", tools });
              break;
            }
            case "tool_arguments_exclude": {
              const value = text("value");
              if (!value) errors.push(`${at}: \`value\` must be a non-empty string.`);
              else parsed.push({ type: "tool_arguments_exclude", value });
              break;
            }
            case "no_retry_after_failure":
              parsed.push({ type: "no_retry_after_failure" });
              break;
            case "no_duplicate_call": {
              // Optional: scoped to one tool, or every tool when omitted.
              if (k.tool === undefined) { parsed.push({ type: "no_duplicate_call" }); break; }
              const tool = text("tool");
              if (!tool) errors.push(`${at}: \`tool\`, when given, must be a non-empty string.`);
              else parsed.push({ type: "no_duplicate_call", tool });
              break;
            }
            case "approval_before": {
              const tool = text("tool");
              if (!tool) errors.push(`${at}: \`tool\` must be a non-empty string.`);
              else parsed.push({ type: "approval_before", tool });
              break;
            }
            case "max_latency_ms": {
              const value = k.value;
              if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
                errors.push(`${at}: \`value\` must be a positive number of milliseconds.`);
              } else parsed.push({ type: "max_latency_ms", value });
              break;
            }
            default:
              errors.push(`${at}: unknown check type ${JSON.stringify(k?.type ?? null)}.`);
          }
        });
  return errors.length === before ? parsed : null;
}

/**
 * Deciding whether a file is a suite we are willing to run.
 *
 * The seeder's old check looked at four top-level keys and never opened the cases,
 * which was survivable when every suite was written in this repo. It is not
 * survivable for an imported one: a case with no assertions gives the judge nothing
 * to check, and it would still produce a confident verdict and a number in a client's
 * report. So every case is validated, and a file with one bad case is rejected whole
 * rather than partially imported — a half-loaded suite silently changes what a score
 * is out of.
 *
 * Errors are collected rather than thrown one at a time, because someone fixing a
 * spreadsheet should see everything wrong with it in one pass.
 */
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export type ValidationResult =
  | { ok: true; suite: Suite }
  | { ok: false; errors: string[] };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  return items.length === value.length ? items : null;
}

export function validateSuite(value: unknown): ValidationResult {
  const errors: string[] = [];
  const v = (value ?? null) as Record<string, unknown> | null;

  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, errors: ["The file is not a suite object."] };
  }

  const key = text(v.key);
  const name = text(v.name);
  const version = v.version;

  if (!key) errors.push("`key` is required and must be a non-empty string.");
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    errors.push("`key` must be lowercase letters, digits and hyphens — it identifies the suite across versions.");
  }
  if (!name) errors.push("`name` is required and must be a non-empty string.");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    errors.push("`version` is required and must be a whole number of 1 or more.");
  }

  if (!Array.isArray(v.cases) || v.cases.length === 0) {
    errors.push("`cases` is required and must contain at least one scenario.");
    return { ok: false, errors };
  }

  const seen = new Set<string>();
  const cases: SuiteCase[] = [];

  v.cases.forEach((raw, index) => {
    const c = (raw ?? null) as Record<string, unknown> | null;
    const where = `case ${index + 1}`;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      errors.push(`${where} is not an object.`);
      return;
    }

    const id = text(c.id);
    const label = id ? `case ${id}` : where;

    if (!id) errors.push(`${where}: \`id\` is required — it is how a finding is named in a report.`);
    else if (seen.has(id)) errors.push(`${label}: duplicate id. Every scenario must be identifiable on its own.`);
    else seen.add(id);

    const category = text(c.category);
    const obligation = text(c.obligation);
    const severity = text(c.severity);
    const input = text(c.input);
    const expected = text(c.expected_behavior);
    const assertions = stringList(c.assertions);

    if (!category) errors.push(`${label}: \`category\` is required.`);
    if (!obligation) errors.push(`${label}: \`obligation\` is required.`);
    if (!severity || !SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
      errors.push(`${label}: \`severity\` must be one of ${SEVERITIES.join(", ")}.`);
    }
    if (!input) errors.push(`${label}: \`input\` is required — it is what gets sent to the agent.`);
    if (!expected) errors.push(`${label}: \`expected_behavior\` is required.`);

    // The rule that matters most. An assertion is what the judge checks; a case with
    // none is ungradable, and a case whose assertions are blank strings is worse,
    // because it looks graded.
    if (!assertions) errors.push(`${label}: \`assertions\` must be a list of non-empty strings.`);
    else if (assertions.length === 0) {
      errors.push(`${label}: at least one assertion is required, or there is nothing for the judge to check.`);
    }

    const forbidden = c.forbidden === undefined ? undefined : stringList(c.forbidden);
    if (c.forbidden !== undefined && forbidden === null) {
      errors.push(`${label}: \`forbidden\` must be a list of non-empty strings when present.`);
    }

    // An effect declaration changes how a pass is evidenced, so a malformed one is
    // rejected rather than ignored: silently dropping it would mean grading an action
    // on the agent's own account of it, which is the failure this product names.
    let effect: SuiteCase["effect"];
    if (c.effect !== undefined) {
      const raw = c.effect as Record<string, unknown> | null;
      const describe = typeof raw?.describe === "string" ? raw.describe.trim() : "";
      const evidence = raw?.evidence;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label}: \`effect\` must be an object when present.`);
      } else if (!describe) {
        errors.push(`${label}: \`effect.describe\` must say what is supposed to happen.`);
      } else if (evidence !== "tool_invoked" && evidence !== "state_confirmed") {
        errors.push(
          `${label}: \`effect.evidence\` must be "tool_invoked" or "state_confirmed" — `
          + "it decides what counts as proof that the action occurred.",
        );
      } else {
        // A scenario saying a state change is expected, with no way for anyone to
        // know, is not wrong — it is the honest default, and it reports as
        // unverified. But a malformed `verify` must be refused rather than dropped:
        // silently ignoring it would report "unverified" while the author believed
        // the read-back was running.
        let verify: NonNullable<SuiteCase["effect"]>["verify"];
        const rawVerify = (raw as Record<string, unknown>).verify;
        if (rawVerify !== undefined) {
          const v = rawVerify as Record<string, unknown>;
          if (!v || typeof v !== "object" || Array.isArray(v)) {
            errors.push(`${label}: \`effect.verify\` must be an object when present.`);
          } else if (evidence !== "state_confirmed") {
            errors.push(`${label}: \`effect.verify\` only applies with evidence "state_confirmed".`);
          } else if (!Array.isArray(v.expect) || v.expect.length === 0) {
            errors.push(`${label}: \`effect.verify.expect\` must list what must hold in the read-back.`);
          } else if (v.path !== undefined && (typeof v.path !== "string" || !v.path.trim())) {
            errors.push(`${label}: \`effect.verify.path\` must be a non-empty string when present.`);
          } else {
            const nested = validateChecks(v.expect, `${label}: effect.verify.expect`, errors);
            if (nested) verify = { ...(typeof v.path === "string" ? { path: v.path } : {}), expect: nested };
          }
        }
        effect = { describe, evidence, ...(verify ? { verify } : {}) };
      }
    }

    // A check that cannot be understood is rejected rather than dropped. A silently
    // ignored `tool_forbidden` would turn the strictest rule in a suite into no rule
    // at all, and the run would look like it had enforced it.
    let checks: SuiteCase["checks"];
    if (c.checks !== undefined) {
      if (!Array.isArray(c.checks)) {
        errors.push(`${label}: \`checks\` must be a list when present.`);
      } else {
        checks = validateChecks(c.checks, label, errors) ?? undefined;
      }
    }

    // Metadata the agent is given about the conversation. Values are forced to
    // strings because this crosses into someone else's request body: a number here
    // and a string there is how one stack's template silently renders `[object
    // Object]` and an injection test attacks nothing at all.
    let context: SuiteCase["context"];
    if (c.context !== undefined) {
      const raw = c.context as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label}: \`context\` must be an object of string values when present.`);
      } else {
        const entries = Object.entries(raw);
        if (!entries.length) {
          errors.push(`${label}: \`context\` must carry at least one field, or leave it out.`);
        } else if (entries.some(([, v]) => typeof v !== "string" || !v.trim())) {
          errors.push(`${label}: every \`context\` value must be a non-empty string.`);
        } else {
          context = Object.fromEntries(entries as Array<[string, string]>);
        }
      }
    }

    // The customer's messages before `input`. Refused rather than dropped when
    // malformed: the validator keeps only fields it knows, so a conversation that lost
    // its earlier turns here would run as a single message under the same name.
    let earlierTurns: string[] | undefined;
    if (c.earlier_turns !== undefined) {
      const list = stringList(c.earlier_turns);
      if (!list || list.length === 0) {
        errors.push(`${label}: \`earlier_turns\` must be a list of the customer's earlier messages, or left out.`);
      } else if (list.length > MAX_EARLIER_TURNS) {
        errors.push(`${label}: \`earlier_turns\` can hold at most ${MAX_EARLIER_TURNS} messages.`);
      } else {
        earlierTurns = list;
      }
    }

    // A simulated customer. Its opening is `input`, written by a person; the model
    // only continues. Refused rather than dropped when malformed, for the same reason
    // as earlier turns.
    let persona: SuiteCase["persona"];
    if (c.persona !== undefined) {
      const raw = c.persona as Record<string, unknown> | null;
      const goal = typeof raw?.goal === "string" ? raw.goal.trim() : "";
      const maxTurns = raw?.max_turns;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label}: \`persona\` must be an object when present.`);
      } else if (!goal) {
        errors.push(`${label}: \`persona.goal\` must say what the customer wants.`);
      } else if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_PERSONA_TURNS) {
        errors.push(`${label}: \`persona.max_turns\` must be a whole number from 1 to ${MAX_PERSONA_TURNS} — how many messages they send after the opening.`);
      } else if (earlierTurns) {
        errors.push(`${label}: a scenario has either \`earlier_turns\` or a \`persona\`, not both.`);
      } else {
        const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
        const facts = raw.facts;
        const factsOk = facts === undefined || (facts !== null && typeof facts === "object" && !Array.isArray(facts)
          && Object.values(facts as Record<string, unknown>).every((v) => typeof v === "string" && v.trim()));
        if (!factsOk) {
          errors.push(`${label}: \`persona.facts\` must be an object of non-empty strings when present.`);
        } else {
          persona = {
            goal,
            max_turns: maxTurns,
            ...(text(raw.style) ? { style: text(raw.style) } : {}),
            ...(text(raw.language) ? { language: text(raw.language) } : {}),
            ...(facts ? { facts: facts as Record<string, string> } : {}),
          };
        }
      }
    }

    // An attack declaration is evidence, so a malformed one is refused. A report that
    // named the wrong channel would describe an attack the run never made.
    let attack: SuiteCase["attack"];
    if (c.attack !== undefined) {
      const raw = c.attack as Record<string, unknown> | null;
      const technique = typeof raw?.technique === "string" ? raw.technique.trim() : "";
      const channel = raw?.channel;
      const reference = typeof raw?.reference === "string" ? raw.reference.trim() : "";
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label}: \`attack\` must be an object when present.`);
      } else if (!technique) {
        errors.push(`${label}: \`attack.technique\` must name what is being attempted.`);
      } else if (channel !== "message" && channel !== "metadata" && channel !== "document" && channel !== "tool_result") {
        errors.push(
          `${label}: \`attack.channel\` must be "message", "metadata", "document" or "tool_result" — `
          + "it records where the hostile input arrived.",
        );
      } else {
        attack = { technique, channel, ...(reference ? { reference } : {}) };
      }
    }

    // The channel has to be one the scenario actually uses. `channel: "metadata"`
    // with no `context` is a scenario that documents an attack it does not make.
    if (attack?.channel === "metadata" && !context) {
      errors.push(`${label}: \`attack.channel\` is "metadata" but the case carries no \`context\` to deliver it in.`);
    }

    // Two flags that can only ever stop something happening. A string "false" would
    // be truthy and would quietly bar a case from every agent, so anything that is not
    // a real boolean is an error rather than a coercion.
    for (const flag of ["destructive", "fixture_only"] as const) {
      if (c[flag] !== undefined && typeof c[flag] !== "boolean") {
        errors.push(`${label}: \`${flag}\` must be true or false when present.`);
      }
    }

    const dutyRefs = c.duty_refs === undefined ? undefined : stringList(c.duty_refs);
    if (c.duty_refs !== undefined && dutyRefs === null) {
      errors.push(`${label}: \`duty_refs\` must be a list of non-empty strings when present.`);
    }

    if (id && category && obligation && severity && input && expected && assertions?.length) {
      cases.push({
        id, category, obligation, severity, input,
        expected_behavior: expected,
        assertions,
        ...(forbidden?.length ? { forbidden } : {}),
        ...(effect ? { effect } : {}),
        ...(checks?.length ? { checks } : {}),
        ...(context ? { context } : {}),
        ...(earlierTurns ? { earlier_turns: earlierTurns } : {}),
        ...(persona ? { persona } : {}),
        ...(attack ? { attack } : {}),
        ...(dutyRefs?.length ? { duty_refs: dutyRefs } : {}),
        ...(c.destructive === true ? { destructive: true } : {}),
        ...(c.fixture_only === true ? { fixture_only: true } : {}),
      });
    }
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, suite: { key: key as string, name: name as string, version: version as number, cases } };
}

/**
 * A minimal RFC 4180 reader — quotes, escaped quotes and embedded newlines.
 *
 * Agencies keep scenarios in spreadsheets, so CSV is the format an imported suite
 * most often arrives in. Anything less than this drops a row the moment someone's
 * prompt contains a comma, which is most prompts.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }

  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const REQUIRED_COLUMNS = ["id", "category", "obligation", "severity", "input", "expected_behavior", "assertions"];

/**
 * A CSV suite. `assertions` and `forbidden` hold several values in one cell, so they
 * are split on `|` — a character that does not appear in ordinary policy prose, unlike
 * a semicolon or a newline.
 */
export function suiteFromCsv(csv: string, meta: { key: string; name: string; version: number }): ValidationResult {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { ok: false, errors: ["The CSV needs a header row and at least one scenario."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return { ok: false, errors: [`The CSV is missing these columns: ${missing.join(", ")}.`] };
  }

  const at = (row: string[], column: string) => (row[header.indexOf(column)] ?? "").trim();
  const split = (value: string) => value.split("|").map((s) => s.trim()).filter(Boolean);

  const cases = rows.slice(1).map((row) => {
    const forbidden = split(at(row, "forbidden"));
    return {
      id: at(row, "id"),
      category: at(row, "category"),
      obligation: at(row, "obligation"),
      severity: at(row, "severity").toLowerCase(),
      input: at(row, "input"),
      expected_behavior: at(row, "expected_behavior"),
      assertions: split(at(row, "assertions")),
      ...(forbidden.length ? { forbidden } : {}),
    };
  });

  return validateSuite({ ...meta, cases });
}
