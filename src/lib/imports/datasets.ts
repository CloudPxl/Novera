import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { canonicalise, type Json } from "../report/hash.ts";
import { looksLikeSecret } from "../assistant/core.ts";
import { SEVERITIES, validateSuite } from "../suites/validate.ts";
import type { SuiteCase } from "../runner/types.ts";
import type { DeterministicCheck } from "../judge/checks.ts";

/**
 * Test cases written for another tool, turned into Novera scenario *drafts*.
 *
 * Three rules, each one the reason this is not a file-format converter:
 *
 *  1. **An import is an input, never a verdict.** A file may carry previous outputs and
 *     scores (DeepEval's `actual_output`, a `success` flag, a LangSmith run's outputs).
 *     They are ignored and the reviewer is told so: Novera runs the scenario and grades
 *     it itself, or the report would be certifying someone else's grading.
 *  2. **Nothing is silently reinterpreted.** Where Novera's meaning differs — `contains`
 *     is case-sensitive in Promptfoo and not here; DeepEval's `context` is reference
 *     knowledge, while Novera's `context` is what the agent is *told* about a
 *     conversation, the channel an injection arrives on — the difference is recorded on
 *     the draft as an adjustment. An assertion type with no equivalent is dropped *and
 *     listed*, never approximated.
 *  3. **Every item lands as a draft.** It cannot run until a named person approves it
 *     (0022), with where it came from — tool, item, the file's hash and the item's own
 *     hash — frozen on the row (0030).
 */

export const TRANSFORMATION_VERSION = 1;
export const MAX_IMPORT_ITEMS = 200;

export type SourceTool = "promptfoo" | "deepeval" | "langsmith" | "langfuse";

export const SOURCE_LABELS: Record<SourceTool, string> = {
  promptfoo: "Promptfoo",
  deepeval: "DeepEval",
  langsmith: "LangSmith",
  langfuse: "Langfuse",
};

export interface ImportProvenance {
  source_tool: SourceTool;
  source_format: "yaml" | "json" | "jsonl";
  source_filename: string;
  /** Where in the file this item was: `tests[3]`, or the tool's own id when it has one. */
  source_id: string;
  /** SHA-256 of the whole file as uploaded. */
  original_hash: string;
  /** SHA-256 of this item, canonicalised — so one item can be traced in a changed file. */
  item_hash: string;
  transformation_version: number;
  /** Where Novera's reading differs from the source tool's. Shown to the reviewer. */
  adjustments: string[];
  /** Assertions with no Novera equivalent, dropped rather than approximated. */
  dropped: string[];
  sanitisation: string;
}

export interface ImportedDraft {
  scenario: SuiteCase;
  provenance: ImportProvenance;
}

export interface ImportOptions {
  filename: string;
  defaultObligation: string;
  defaultSeverity: string;
  /** The variable holding the customer's message, when a file has several. */
  inputVar?: string;
  usedIds: Iterable<string>;
}

export type ImportResult =
  | { ok: true; tool: SourceTool; drafts: ImportedDraft[]; refused: Array<{ source_id: string; reason: string }>; notes: string[] }
  | { ok: false; error: string };

const INPUT_NAMES = ["input", "query", "question", "message", "user_input", "prompt", "customer_message", "text"];

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Ids are ours (see `nextCaseId`): `I01`, `I02`… never taken from the file. */
function importIds(used: Iterable<string>): () => string {
  let highest = 0;
  for (const id of used) {
    const m = /^I(\d+)$/.exec(id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return () => `I${String(++highest).padStart(2, "0")}`;
}

function readFile(text: string, filename: string): { value: unknown; format: ImportProvenance["source_format"] } | { error: string } {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
      const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
      return { value: rows, format: "jsonl" };
    }
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
      // Plain data only: no custom tags, and a bounded alias expansion so a
      // "billion laughs" file cannot exhaust the function.
      return { value: parseYaml(text, { maxAliasCount: 100, customTags: [] }), format: "yaml" };
    }
    return { value: JSON.parse(text), format: "json" };
  } catch (e) {
    return { error: `The file could not be read: ${e instanceof Error ? e.message.split("\n")[0] : "parse error"}.` };
  }
}

/** Which tool wrote this, from its shape. Refuses rather than guesses when it cannot tell. */
export function detectTool(value: unknown): { tool: SourceTool; items: unknown[]; defaults?: Record<string, unknown> } | { error: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if ("tests" in v || "prompts" in v || "defaultTest" in v) {
      if (typeof v.tests === "string" || (Array.isArray(v.tests) && v.tests.some((t) => typeof t === "string"))) {
        return { error: "This Promptfoo config points at a separate tests file. Upload that file instead." };
      }
      if (!Array.isArray(v.tests)) return { error: "This Promptfoo config has no “tests” list." };
      return { tool: "promptfoo", items: v.tests, defaults: (v.defaultTest ?? undefined) as Record<string, unknown> | undefined };
    }
    for (const key of ["goldens", "test_cases", "examples", "items", "data"]) {
      if (Array.isArray(v[key])) return detectTool(v[key]);
    }
    return { error: "No list of test cases was found in this file." };
  }
  if (!Array.isArray(value) || value.length === 0) return { error: "The file holds no test cases." };

  const first = value.find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;
  if (!first) return { error: "The file holds no test cases." };
  if ("vars" in first || "assert" in first) return { tool: "promptfoo", items: value };
  if ("inputs" in first) return { tool: "langsmith", items: value };
  if ("expectedOutput" in first || "datasetId" in first) return { tool: "langfuse", items: value };
  if ("input" in first) return { tool: "deepeval", items: value };
  return { error: "This does not look like a Promptfoo, DeepEval, LangSmith or Langfuse dataset." };
}

/** The customer's message from a map of variables. */
function pickInput(vars: unknown, preferred?: string): { input: string; used: string } | { error: string } {
  if (typeof vars === "string") return str(vars) ? { input: vars.trim(), used: "input" } : { error: "The input is empty." };
  if (!vars || typeof vars !== "object") return { error: "No input was found." };
  const map = vars as Record<string, unknown>;
  const strings = Object.entries(map).filter(([, v]) => str(v));
  if (preferred) {
    const v = str(map[preferred]);
    return v ? { input: v, used: preferred } : { error: `It has no “${preferred}” variable.` };
  }
  for (const name of INPUT_NAMES) {
    const v = str(map[name]);
    if (v) return { input: v, used: name };
  }
  if (strings.length === 1) return { input: (strings[0][1] as string).trim(), used: strings[0][0] };
  return {
    error: `It is unclear which variable is the customer's message (${Object.keys(map).join(", ") || "none"}). `
      + "Name it in the form, or rename it to “input”.",
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Mapped {
  assertions: string[];
  checks: DeterministicCheck[];
  adjustments: string[];
  dropped: string[];
}

/** Promptfoo assertions, one by one. */
function mapPromptfooAsserts(asserts: unknown[]): Mapped {
  const out: Mapped = { assertions: [], checks: [], adjustments: [], dropped: [] };
  const note = (list: string[], text: string) => { if (!list.includes(text)) list.push(text); };

  for (const raw of asserts) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const type = String(a.type ?? "");
    const value = a.value;
    const values = Array.isArray(value) ? value.map(String).filter((s) => s.trim()) : str(value) ? [String(value).trim()] : [];

    switch (type) {
      case "contains":
      case "icontains":
      case "contains-all":
      case "icontains-all":
        for (const v of values) out.checks.push({ type: "must_contain", value: v });
        if (!type.startsWith("i")) note(out.adjustments, "“contains” is compared without regard to case here; Promptfoo compares it exactly.");
        break;
      case "not-contains":
      case "not-icontains":
      case "not-contains-any":
      case "not-icontains-any":
        for (const v of values) out.checks.push({ type: "must_not_contain", value: v });
        if (!type.includes("icontains")) note(out.adjustments, "“not-contains” is compared without regard to case here, which is stricter than Promptfoo.");
        break;
      case "contains-any":
      case "icontains-any":
        if (values.length) out.checks.push({ type: "must_match", pattern: values.map(escapeRegExp).join("|") });
        note(out.adjustments, "“contains-any” became one pattern, compared without regard to case.");
        break;
      case "regex":
      case "not-regex":
        if (values[0]) {
          out.checks.push({ type: type === "regex" ? "must_match" : "must_not_match", pattern: values[0] });
          note(out.adjustments, "Regular expressions are matched without regard to case here.");
        }
        break;
      case "latency": {
        const threshold = Number(a.threshold);
        if (Number.isFinite(threshold) && threshold > 0) out.checks.push({ type: "max_latency_ms", value: threshold });
        else note(out.dropped, "latency (no threshold)");
        break;
      }
      case "llm-rubric":
      case "model-graded-closedqa":
      case "g-eval":
        for (const v of values) out.assertions.push(v);
        break;
      case "factuality":
      case "model-graded-factuality":
        for (const v of values) out.assertions.push(`The reply is factually consistent with: ${v}`);
        break;
      case "equals":
        for (const v of values) out.assertions.push(`The reply says, in substance: ${v}`);
        note(out.adjustments, "“equals” became a graded expectation — an exact-match rule would fail any reworded correct answer.");
        break;
      default:
        note(out.dropped, type || "an assertion with no type");
    }
  }
  return out;
}

function checkIsValid(checks: DeterministicCheck[]): string | null {
  for (const c of checks) {
    if ((c.type === "must_match" || c.type === "must_not_match")) {
      try { new RegExp(c.pattern, "i"); } catch { return `/${c.pattern}/ is not a valid regular expression.`; }
    }
  }
  return null;
}

export function importDataset(text: string, options: ImportOptions): ImportResult {
  if (!obligationOk(options.defaultObligation)) return { ok: false, error: "Choose which obligation these scenarios test." };
  if (!SEVERITIES.includes(options.defaultSeverity as (typeof SEVERITIES)[number])) {
    return { ok: false, error: `Severity must be one of ${SEVERITIES.join(", ")}.` };
  }
  const read = readFile(text, options.filename);
  if ("error" in read) return { ok: false, error: read.error };
  const detected = detectTool(read.value);
  if ("error" in detected) return { ok: false, error: detected.error };
  if (detected.items.length > MAX_IMPORT_ITEMS) {
    return { ok: false, error: `The file has ${detected.items.length} test cases; the limit is ${MAX_IMPORT_ITEMS} per import. Split it.` };
  }

  const { tool, items } = detected;
  const originalHash = sha256(text);
  const nextId = importIds(options.usedIds);
  const drafts: ImportedDraft[] = [];
  const refused: Array<{ source_id: string; reason: string }> = [];
  const notes: string[] = [];
  let ignoredResults = 0;

  items.forEach((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const ownId = str(item.id) ?? str(item.name) ?? null;
    const sourceId = tool === "promptfoo" ? `tests[${index}]` : ownId ? `${ownId}` : `[${index}]`;
    const refuse = (reason: string) => refused.push({ source_id: sourceId, reason });

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return refuse("Not a test case object.");
    // Before anything is stored: a credential in a dataset is refused, not kept.
    if (looksLikeSecret(JSON.stringify(item))) return refuse("It contains what looks like an API key or token, so it was not stored.");

    const adjustments: string[] = [];
    let dropped: string[] = [];
    let assertions: string[] = [];
    let checks: DeterministicCheck[] = [];
    let input: string;
    let expected: string | null = null;
    const meta = ((item.metadata ?? item.additional_metadata ?? {}) as Record<string, unknown>) || {};

    if (tool === "promptfoo") {
      const defaults = (detected.defaults ?? {}) as Record<string, unknown>;
      const vars = { ...((defaults.vars as object) ?? {}), ...((item.vars as object) ?? {}) };
      const picked = pickInput(vars, options.inputVar);
      if ("error" in picked) return refuse(picked.error);
      input = picked.input;
      if (Object.keys(vars).length > 1) adjustments.push(`“${picked.used}” was taken as the customer's message; the other variables were not sent.`);
      const mapped = mapPromptfooAsserts([
        ...(Array.isArray(defaults.assert) ? defaults.assert : []),
        ...(Array.isArray(item.assert) ? item.assert : []),
      ]);
      assertions = mapped.assertions;
      checks = mapped.checks;
      adjustments.push(...mapped.adjustments);
      dropped = mapped.dropped;
      expected = str(item.description);
    } else if (tool === "deepeval") {
      const picked = pickInput(item.input, undefined);
      if ("error" in picked) return refuse(picked.error);
      input = picked.input;
      const expectedOutput = str(item.expected_output);
      if (expectedOutput) assertions.push(`The reply is consistent with this expected answer: ${expectedOutput}`);
      const context = Array.isArray(item.context) ? item.context.map(String).filter((s) => s.trim()) : [];
      if (context.length) {
        assertions.push(`The reply does not contradict these facts: ${context.join(" · ")}`);
        adjustments.push("DeepEval “context” is reference knowledge, so it became something the reply must not contradict. It was not sent to the agent.");
      }
      if (item.retrieval_context) dropped.push("retrieval_context (it describes a previous run's retrieval)");
      expected = str(item.name) ?? str(item.comments);
      if ("actual_output" in item || "success" in item || "score" in item) ignoredResults++;
    } else {
      // LangSmith `{inputs, outputs}` and Langfuse `{input, expectedOutput}`.
      const inputs = tool === "langsmith" ? item.inputs : item.input;
      const picked = pickInput(inputs, options.inputVar);
      if ("error" in picked) return refuse(picked.error);
      input = picked.input;
      const outputs = tool === "langsmith" ? item.outputs : item.expectedOutput;
      const reference = typeof outputs === "string" ? str(outputs)
        : outputs && typeof outputs === "object"
          ? Object.values(outputs as Record<string, unknown>).map((v) => str(v)).find(Boolean) ?? null
          : null;
      if (reference) assertions.push(`The reply is consistent with this reference answer: ${reference}`);
      expected = str(meta.description) ?? str(meta.expected_behavior);
    }

    // A rule can fail a scenario but never pass one, so a scenario needs an expectation
    // a grader can judge. The item's description is used only as a last resort, and the
    // reviewer is told.
    if (assertions.length === 0) {
      if (!expected) {
        return refuse(
          checks.length
            ? "It has only rule checks (like contains). In Novera a rule can fail a scenario but never pass one, so it needs an expectation too — an llm-rubric, an expected output, or a description."
            : "It has no expectation to grade against.",
        );
      }
      assertions = [expected];
      adjustments.push("The item's description was used as its expectation — read it as one before approving.");
    }
    const badCheck = checkIsValid(checks);
    if (badCheck) return refuse(badCheck);

    const obligation = str(meta.obligation) && obligationOk(String(meta.obligation)) ? String(meta.obligation) : options.defaultObligation;
    const severity = str(meta.severity) && SEVERITIES.includes(String(meta.severity) as never) ? String(meta.severity) : options.defaultSeverity;

    const scenario: SuiteCase = {
      id: nextId(),
      category: str(meta.category) ?? "imported",
      obligation,
      severity,
      input,
      expected_behavior: expected ?? assertions[0],
      assertions,
      ...(checks.length ? { checks } : {}),
    };

    // The same validator an uploaded suite and a drafted scenario pass, so an import
    // cannot store a draft that could never run.
    const valid = validateSuite({ key: "import-check", name: "import", version: 1, cases: [scenario] });
    if (!valid.ok) return refuse(valid.errors.join(" "));

    const personal = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(input) || /\+?\d[\d\s().-]{8,}\d/.test(input);
    drafts.push({
      scenario: valid.suite.cases[0],
      provenance: {
        source_tool: tool,
        source_format: read.format,
        source_filename: options.filename,
        source_id: sourceId,
        original_hash: originalHash,
        item_hash: sha256(canonicalise(item as Json)),
        transformation_version: TRANSFORMATION_VERSION,
        adjustments,
        dropped,
        sanitisation: personal
          ? "not sanitised — the input contains what looks like an email address or phone number"
          : "not sanitised — stored exactly as supplied",
      },
    });
  });

  if (ignoredResults > 0) {
    notes.push(`${ignoredResults} item(s) carried outputs or scores from a previous run. They were ignored: Novera runs each scenario and grades it itself.`);
  }
  return { ok: true, tool, drafts, refused, notes };
}

/** An obligation code: the known ones, or a new snake_case code a customer defines. */
function obligationOk(code: string): boolean {
  return /^[a-z][a-z0-9_]{2,60}$/.test(code);
}
