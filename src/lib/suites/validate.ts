import type { Suite, SuiteCase } from "../runner/types.ts";

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
        effect = { describe, evidence };
      }
    }

    if (id && category && obligation && severity && input && expected && assertions?.length) {
      cases.push({
        id, category, obligation, severity, input,
        expected_behavior: expected,
        assertions,
        ...(forbidden?.length ? { forbidden } : {}),
        ...(effect ? { effect } : {}),
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
