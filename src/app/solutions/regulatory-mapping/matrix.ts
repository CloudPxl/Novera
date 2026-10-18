import suiteFile from "../../../../data/suites/eu-support-v7.json" with { type: "json" };
import { OBLIGATION_LABELS } from "../../../lib/report/payload.ts";
import { SUITE } from "../_components/content.ts";

/**
 * The regulatory mapping, computed from the suite a new run uses — never typed.
 *
 * Every row is a `duty_refs` entry that at least one scenario of {@link SUITE} carries, and every
 * scenario under it is one that carries it. How a scenario is checked is read off its own fields:
 * declared `checks`/`turn_checks` are rules, an `effect` names its proof (the agent's recorded tool
 * activity, or a read-back from the customer's system), and assertions go to the graders. Nothing
 * here says a duty applies to anyone, or that one is met: a reference files evidence for a reader
 * who already carries the duty.
 *
 * Relative imports only: `tests/regulatory-mapping.test.ts` loads this file without the `@/` alias,
 * and re-counts every figure from the JSON on disk.
 */

interface SuiteFileCase {
  id: string;
  category: string;
  obligation: string;
  severity: string;
  assertions: string[];
  checks?: unknown[];
  turn_checks?: unknown[];
  effect?: { describe: string; evidence: string };
  attack?: { technique: string; channel: string };
  duty_refs?: string[];
}

export const SUITE_CASES: readonly SuiteFileCase[] = (suiteFile as { version: number; cases: SuiteFileCase[] }).cases;
export const SUITE_FILE_VERSION: number = (suiteFile as { version: number }).version;

export type Framework = "ai-act" | "gdpr";
export const FRAMEWORKS: ReadonlyArray<{ id: Framework; name: string; prefix: string }> = [
  { id: "ai-act", name: "EU AI Act", prefix: "EU AI Act Art. " },
  { id: "gdpr", name: "GDPR", prefix: "GDPR Art. " },
];

/**
 * How a scenario's verdict can be reached, in the order the runner applies them. Each is derived
 * from a field the scenario declares; a layer a scenario does not declare is not claimed for it.
 */
export type Layer = "rules" | "tool-record" | "read-back" | "graders";
export const LAYERS: ReadonlyArray<{ id: Layer; name: string; body: string }> = [
  {
    id: "rules",
    name: "Rules",
    body: "Deterministic checks the scenario declares — text or patterns that must not appear, tools that must not be called, tool arguments required or excluded, turn by turn in a conversation. A rule can fail a scenario and can never pass one.",
  },
  {
    id: "tool-record",
    name: "Tool record",
    body: "The scenario expects an action. A pass needs tool activity recorded by the agent; a reply that only says the action happened gets no verdict, never a pass.",
  },
  {
    id: "read-back",
    name: "Read-back",
    body: "The scenario expects a change in your own system. A pass needs a read-only call to that system to confirm it; a contradiction fails the scenario with no model asked, and with no read-back configured the scenario gets no verdict.",
  },
  {
    id: "graders",
    name: "Graders",
    body: "Whatever rules and read-back leave open goes to models, each reading the expected behaviour and assertions against the reply. On Novera's keys two models from different vendors grade and a third settles a split; on your own key, the report says how it was corroborated.",
  },
];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface MappedScenario {
  id: string;
  /** The obligation, in the words the report uses. */
  label: string;
  /** What distinguishes it from others with the same obligation, from its own fields; null when nothing does. */
  detail: string | null;
  severity: Severity;
  layers: Layer[];
}

export interface MatrixRow {
  /** The reference exactly as the suite writes it. */
  ref: string;
  framework: Framework;
  /** "50(1)", "5(1)(c)", "17". */
  article: string;
  /** The article number alone, which the `article` filter matches: "50", "5", "17". */
  articleNumber: string;
  anchor: string;
  heading: string | null;
  scenarios: MappedScenario[];
}

/**
 * The article headings as the regulations title them, for the references the suite uses. A
 * reference missing here is shown without a heading rather than with a guessed one.
 */
export const ARTICLE_HEADINGS: Readonly<Record<string, string>> = {
  "EU AI Act Art. 13": "Transparency and provision of information to deployers",
  "EU AI Act Art. 14": "Human oversight",
  "EU AI Act Art. 15": "Accuracy, robustness and cybersecurity",
  "EU AI Act Art. 50(1)": "Transparency obligations: informing people they are interacting with an AI system",
  "GDPR Art. 5(1)(c)": "Principles: data minimisation",
  "GDPR Art. 5(1)(f)": "Principles: integrity and confidentiality",
  "GDPR Art. 12(6)": "Confirming the identity of the person making a request",
  "GDPR Art. 15": "Right of access by the data subject",
  "GDPR Art. 16": "Right to rectification",
  "GDPR Art. 17": "Right to erasure",
  "GDPR Art. 18": "Right to restriction of processing",
  "GDPR Art. 19": "Notifying recipients of rectification, erasure or restriction",
  "GDPR Art. 20": "Right to data portability",
  "GDPR Art. 21": "Right to object",
  "GDPR Art. 22": "Automated individual decision-making, including profiling",
  "GDPR Art. 25": "Data protection by design and by default",
  "GDPR Art. 32": "Security of processing",
  "GDPR Art. 33": "Notification of a personal data breach to the supervisory authority",
};

export function layersOf(c: SuiteFileCase): Layer[] {
  const out: Layer[] = [];
  if ((c.checks?.length ?? 0) > 0 || (c.turn_checks?.length ?? 0) > 0) out.push("rules");
  if (c.effect?.evidence === "tool_invoked") out.push("tool-record");
  if (c.effect?.evidence === "state_confirmed") out.push("read-back");
  if (c.assertions.length > 0) out.push("graders");
  return out;
}

function parseRef(ref: string): { framework: Framework; article: string } | null {
  for (const f of FRAMEWORKS) {
    if (ref.startsWith(f.prefix)) return { framework: f.id, article: ref.slice(f.prefix.length) };
  }
  return null;
}

function compareArticles(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  return na - nb || a.localeCompare(b);
}

function toScenario(c: SuiteFileCase): MappedScenario {
  const detail = c.attack ? `Attack: ${c.attack.technique}` : c.effect ? `Expects: ${c.effect.describe}` : null;
  return {
    id: c.id,
    label: OBLIGATION_LABELS[c.obligation] ?? c.obligation.replace(/_/g, " "),
    detail,
    severity: (SEVERITIES as readonly string[]).includes(c.severity) ? (c.severity as Severity) : "low",
    layers: layersOf(c),
  };
}

/** Every reference the suite carries, AI Act first, each with the scenarios that carry it in suite order. */
export function buildMatrix(cases: readonly SuiteFileCase[] = SUITE_CASES): MatrixRow[] {
  const byRef = new Map<string, SuiteFileCase[]>();
  for (const c of cases) for (const r of c.duty_refs ?? []) byRef.set(r, [...(byRef.get(r) ?? []), c]);

  const rows: MatrixRow[] = [];
  for (const [ref, carriers] of byRef) {
    const parsed = parseRef(ref);
    if (!parsed) continue;
    const articleNumber = String(Number.parseInt(parsed.article, 10));
    rows.push({
      ref,
      framework: parsed.framework,
      article: parsed.article,
      articleNumber,
      anchor: `${parsed.framework}-art-${parsed.article.replace(/[()]+/g, "-").replace(/-+$/, "")}`.toLowerCase(),
      heading: ARTICLE_HEADINGS[ref] ?? null,
      scenarios: carriers.map(toScenario),
    });
  }
  const order = (f: Framework) => FRAMEWORKS.findIndex((x) => x.id === f);
  return rows.sort((a, b) => order(a.framework) - order(b.framework) || compareArticles(a.article, b.article));
}

/** References the suite carries that this page cannot place under a framework; shown, not dropped silently. */
export function unplacedRefs(cases: readonly SuiteFileCase[] = SUITE_CASES): string[] {
  const all = new Set<string>();
  for (const c of cases) for (const r of c.duty_refs ?? []) all.add(r);
  return [...all].filter((r) => !parseRef(r)).sort();
}

export interface Filters {
  framework: Framework | null;
  article: string | null;
  layer: Layer | null;
}

/**
 * Reads the filters from the address. Only known values are taken; anything else is ignored, never
 * echoed back onto the page.
 */
export function readFilters(query: Record<string, string | string[] | undefined>, rows: readonly MatrixRow[]): Filters {
  const one = (k: string) => {
    const v = query[k];
    return typeof v === "string" ? v : null;
  };
  const fw = one("framework");
  const framework = FRAMEWORKS.some((f) => f.id === fw) ? (fw as Framework) : null;
  const art = one("article");
  const article = art && rows.some((r) => r.articleNumber === art && (!framework || r.framework === framework)) ? art : null;
  const ly = one("layer");
  const layer = LAYERS.some((l) => l.id === ly) ? (ly as Layer) : null;
  return { framework, article, layer };
}

export interface FilteredRow extends MatrixRow {
  /** The scenarios the layer filter keeps; every scenario when there is none. */
  shown: MappedScenario[];
}

export function applyFilters(rows: readonly MatrixRow[], f: Filters): FilteredRow[] {
  return rows
    .filter((r) => (!f.framework || r.framework === f.framework) && (!f.article || r.articleNumber === f.article))
    .map((r) => ({ ...r, shown: f.layer ? r.scenarios.filter((s) => s.layers.includes(f.layer!)) : r.scenarios }))
    .filter((r) => r.shown.length > 0);
}

/** The address for a set of filters, landing on the matrix. */
export function filterHref(f: Partial<Filters>): string {
  const p = new URLSearchParams();
  if (f.framework) p.set("framework", f.framework);
  if (f.article) p.set("article", f.article);
  if (f.layer) p.set("layer", f.layer);
  const q = p.toString();
  return `/solutions/regulatory-mapping${q ? `?${q}` : ""}#matrix`;
}

/** Headline figures, each counted from the suite. */
export function matrixTotals(rows: readonly MatrixRow[] = buildMatrix(), cases: readonly SuiteFileCase[] = SUITE_CASES) {
  const refsIn = (fw: Framework) => rows.filter((r) => r.framework === fw).length;
  const carrying = (fw: Framework) =>
    cases.filter((c) => (c.duty_refs ?? []).some((r) => parseRef(r)?.framework === fw)).length;
  return {
    scenarios: cases.length,
    mapped: cases.filter((c) => (c.duty_refs ?? []).some((r) => parseRef(r) !== null)).length,
    refs: rows.length,
    aiActRefs: refsIn("ai-act"),
    gdprRefs: refsIn("gdpr"),
    aiActScenarios: carrying("ai-act"),
    gdprScenarios: carrying("gdpr"),
    byLayer: Object.fromEntries(LAYERS.map((l) => [l.id, cases.filter((c) => layersOf(c).includes(l.id)).length])) as Record<Layer, number>,
  };
}

export { SUITE };
