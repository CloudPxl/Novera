import type { ReportPayload } from "../report/payload.ts";
import type { Coverage } from "../evidence/coverage.ts";
import { GRADE_BANDS, type Grade, type GradeBand } from "../evidence/grade.ts";
import { REPORT_NOTICE_TITLE } from "../legal/notices.ts";

/**
 * "How to read this report (60-second guide)": the same few paragraphs for the client report
 * (`/report/[token]`) and the run page (`/runs/[id]`), written for a reader who has never met the
 * words read-back, consensus or SHA-256.
 *
 * Every number in it is read from what the page itself shows — a sealed payload, or the run's
 * stored rows — never a constant. A payload sealed before a field existed gets a sentence saying
 * the report predates it, never a zero it did not record (the absence-branch rule: a report
 * already in a client's hands must keep rendering).
 *
 * It sits beside the sealed content, like Novera's standing notice (src/lib/legal/notices.ts):
 * it is Novera's explanation of how to read any report, part of no payload, and changes no hash.
 * Pure, so the pages and the tests read the same text. The words follow the language rule
 * (src/lib/report/language.ts): testing evidence, never a certification or a promise.
 */

export const READING_A_REPORT_HREF = "/docs/reading-a-report";
export const PLAIN_WORDS_HREF = "/docs/novera-in-plain-words";
/** Printed on paper, where a relative address means nothing. */
const VERIFY_ON_PAPER = "www.nover.space/verify";

export interface GuideFacts {
  /** The client's sealed document, or the operator's run page. */
  subject: "report" | "run";
  /** `novera.format` of a sealed payload (0 when the payload carries none); null for a run read from its rows. */
  format: number | null;
  planned: number;
  passed: number;
  failed: number;
  /** Scenarios that ran and produced no verdict, whatever the reason. */
  errored: number;
  notRun: number;
  /** Null where the document predates the count (formats 1–4). */
  unverifiable: number | null;
  /** Null where no grade was recorded (format 1). */
  band: GradeBand | null;
  /** Claimed actions checked in the customer's own system; null where the document predates the count (formats 1–8). */
  effects: { confirmed: number; contradicted: number } | null;
  /** Verdicts only one grading model gave (no second opinion was available); null where not recorded. */
  oneGrader: number | null;
  /** A format-1 report: corroboration was not recorded, every verdict came from one model. */
  singleModel: boolean;
  /** A run against Novera's scripted fixture. */
  fixture: boolean;
  /** Some conversations continued with a model playing the customer. */
  simulated: boolean;
  /** Whether a sealed report exists for what this guide describes. */
  sealed: boolean;
}

export interface GuidePart {
  id: "what" | "results" | "actions" | "seal";
  title: string;
  paragraphs: string[];
}

export interface ReportGuide {
  /** The disclosure's own label. */
  summary: string;
  parts: GuidePart[];
  /** The closing line: testing evidence, not a certification. */
  scope: string;
  /** The compact legend printed on the report's cover: four entries, no links, no `?`. */
  legend: Array<{ term: string; text: string }>;
  docsHref: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The words a sealed report's limitations carry when a model played the customer (src/lib/report/build.ts). */
const SIMULATED_MARK = /language model played the customer/i;

/** The facts of a sealed payload, of any format. Every field read defensively. */
export function guideFactsFromPayload(payload: ReportPayload): GuideFacts {
  const c = payload.coverage ?? ({} as Partial<ReportPayload["coverage"]>);
  const corroboration = payload.run?.corroboration;
  return {
    subject: "report",
    format: n0(payload.novera?.format),
    planned: n0(c.planned),
    passed: n0(c.passed),
    failed: n0(c.failed),
    errored: n0(c.errored),
    notRun: n0(c.not_run),
    unverifiable: typeof c.unverifiable === "number" ? c.unverifiable : null,
    band: payload.grade?.band ?? null,
    effects: typeof c.effect_confirmed === "number"
      ? { confirmed: c.effect_confirmed, contradicted: n0(c.effect_contradicted) }
      : null,
    oneGrader: corroboration ? n0(corroboration.uncorroborated) : null,
    singleModel: !corroboration,
    fixture: /fixture/i.test(payload.subject?.environment ?? ""),
    simulated: SIMULATED_MARK.test(payload.limitations ?? ""),
    sealed: true,
  };
}

/** The facts of a run read from its stored rows, under the current rules (the run page). */
export function guideFactsFromRun(args: {
  coverage: Coverage;
  grade: Pick<Grade, "band">;
  fixture: boolean;
  simulated: boolean;
  sealed: boolean;
  /** Verdicts only one model gave, when the page counted them. */
  oneGrader?: number | null;
}): GuideFacts {
  const c = args.coverage;
  return {
    subject: "run",
    format: null,
    planned: c.planned,
    passed: c.passed,
    failed: c.failed,
    errored: c.errored,
    notRun: c.notRun,
    unverifiable: c.unverifiable,
    band: args.grade.band,
    effects: { confirmed: c.effectConfirmed, contradicted: c.effectContradicted },
    oneGrader: args.oneGrader ?? null,
    singleModel: false,
    fixture: args.fixture,
    simulated: args.simulated,
    sealed: args.sealed,
  };
}

const LETTERS = GRADE_BANDS.map((b) => `${b.band} from ${b.min}%`).join(", ");

function gradeSentence(f: GuideFacts): string {
  const old = f.format !== null && f.format < 6;
  switch (f.band) {
    case null:
      return "This report was sealed before Novera gave grade letters. Its score is the share of the scenarios with a verdict that passed.";
    case "WITHHELD":
      return `The grade is WITHHELD: every scenario ran, but ${plural(f.errored, "scenario", "scenarios")} produced no verdict, so no letter is given. A letter worked out only over the scenarios that happened to work would claim more than the ${f.subject} showed.`;
    case "INCOMPLETE":
      return old
        ? "The grade is INCOMPLETE: no letter is given. This report was sealed before Novera told apart \"some scenarios never ran\" from \"everything ran, but some scenarios have no verdict\", so here it can mean either."
        : `The grade is INCOMPLETE: ${plural(f.notRun, "scenario", "scenarios")} never ran, so no letter is given. A letter would describe the scenarios that ran and say nothing about the rest.`;
    default:
      return `The grade ${f.band} is the share of the scenarios with a verdict that passed: ${LETTERS}, F below that. Scenarios without a result are left out of that share and counted on their own.`;
  }
}

function legendGrade(f: GuideFacts): string {
  switch (f.band) {
    case null: return "Score: the share of verdicts that passed.";
    case "WITHHELD": return "WITHHELD: everything ran, some scenarios have no verdict, so no letter.";
    case "INCOMPLETE": return f.format !== null && f.format < 6
      ? "INCOMPLETE: no letter (sealed before \"never ran\" and \"no verdict\" were told apart)."
      : "INCOMPLETE: some scenarios never ran, so no letter.";
    default: return `Grade ${f.band}: the share of verdicts that passed (${LETTERS}).`;
  }
}

export function buildReportGuide(f: GuideFacts): ReportGuide {
  const thing = f.subject === "report" ? "report" : "run";
  const sent = Math.max(0, f.planned - f.notRun);

  // ------------------------------------------------------------------ what we did
  const what: string[] = [
    f.notRun === 0
      ? `Novera sent ${plural(f.planned, "realistic customer conversation", "realistic customer conversations")} ("scenarios") to the AI agent and recorded what came back each time. Some are ordinary requests; some are deliberate tricks and attacks.`
      : `The suite holds ${plural(f.planned, "realistic customer conversation", "realistic customer conversations")} ("scenarios"). Novera sent ${sent} of them to the AI agent and recorded what came back; ${f.notRun} never ran.`,
  ];
  if (f.simulated) {
    what.push("In some of them, after an opening message written by a person, an AI model played the customer. Those conversations are test data: no real customer took part.");
  }
  if (f.fixture) {
    what.push("Test data: this run tested Novera's own scripted test agent, not a real one. Nothing in it describes a real agent or a real customer.");
  }

  // ------------------------------------------------------------------ results
  const results: string[] = [
    f.singleModel
      ? "Passed means the agent's reply did what the scenario expected. This report was sealed before Novera asked a second grader, so each verdict came from one AI model."
      : "Passed means the agent's reply did what the scenario expected. AI graders decide that: normally two models from different companies, with a third settling any disagreement. The report says where they came from one company, or where only one graded. Where a scenario expects an action, a pass also needs evidence that the action happened.",
    "Failed means the reply broke a rule written into the scenario, the graders found it fell short of what was expected, or the company's own system showed that an action the agent claimed did not happen.",
    "Some scenarios have no result: the agent did not answer, the graders could not agree, a claimed action could not be confirmed, or the scenario never ran. They are counted on their own and never as passes.",
    `In this ${thing}: ${f.passed} passed, ${f.failed} failed, ${f.errored} without a result, ${f.notRun} not run.`
      + (f.oneGrader ? ` ${plural(f.oneGrader, "verdict rests", "verdicts rest")} on one grader only, not confirmed by a second.` : ""),
    gradeSentence(f),
  ];
  if (f.band !== "WITHHELD" && f.band !== "INCOMPLETE") {
    results.push("Two words can stand where a letter would: WITHHELD (everything ran, but some scenarios have no verdict) and INCOMPLETE (some scenarios never ran).");
  }

  // ------------------------------------------------------------------ claimed actions
  const actions: string[] = [
    "When the agent tells a customer it has done something, such as issuing a refund or opening a ticket, the company can give Novera a read-only connection to its own system. Novera then looks there for itself instead of taking the agent's word. If the system disagrees, the scenario fails. If nothing could confirm the action, the scenario has no result, never a pass.",
  ];
  if (f.effects === null) {
    actions.push("This report was sealed before Novera recorded these checks, so it does not count them.");
  } else if (f.effects.confirmed + f.effects.contradicted > 0) {
    actions.push(`In this ${thing}: ${plural(f.effects.confirmed, "claimed action was", "claimed actions were")} confirmed in the company's system, and ${plural(f.effects.contradicted, "was", "were")} contradicted by it.`);
  } else {
    actions.push(`In this ${thing}, no claimed action was checked this way. Only scenarios that expect an action are checked, and only where the company set up that connection.`);
  }
  if (f.unverifiable) {
    actions.push(`${plural(f.unverifiable, "scenario", "scenarios")} described an action that nothing could confirm, so ${f.unverifiable === 1 ? "it has" : "they have"} no result.`);
  }

  // ------------------------------------------------------------------ the seal
  const seal: string[] = f.sealed
    ? [
        `${f.subject === "report" ? "The report" : "This run's report"} carries a digital fingerprint (a SHA-256 digest) calculated from its content. If anyone changed a single character after sealing, the fingerprint would no longer match.`,
        "Anyone can check it at /verify, by pasting the fingerprint or dropping the report's JSON download onto the page. A match shows the document was not changed after sealing. It does not show that the agent is safe, or that anyone meets the law.",
      ]
    : [
        "A finished run's report is sealed with a digital fingerprint (a SHA-256 digest): if anyone changed a single character afterwards, it would no longer match. This run has no sealed report, so there is nothing to check at /verify yet.",
      ];

  const effectsLegend = f.effects === null
    ? " (not counted in reports of this age)"
    : f.effects.confirmed + f.effects.contradicted > 0
      ? `: here ${f.effects.confirmed} confirmed, ${f.effects.contradicted} contradicted`
      : ": none checked here";

  return {
    summary: `How to read this ${thing} (60-second guide)`,
    parts: [
      { id: "what", title: "What was done", paragraphs: what },
      { id: "results", title: "Passed, failed, or no result", paragraphs: results },
      { id: "actions", title: "Claimed actions, checked", paragraphs: actions },
      { id: "seal", title: "The seal", paragraphs: seal },
    ],
    scope: `${REPORT_NOTICE_TITLE}: this covers the scenarios listed, on the date shown. It is not a certification, a conformity assessment or a legal conclusion.`,
    legend: [
      {
        term: "What was done",
        text: `${sent} of ${plural(f.planned, "realistic customer conversation", "realistic customer conversations")} sent to the AI agent, every answer recorded.`
          + (f.simulated ? " In some, an AI model played the customer: test data." : "")
          + (f.fixture ? " Test data: Novera's scripted test agent, not a real one." : ""),
      },
      {
        term: "Results",
        text: `Passed: did what the scenario expected, judged by AI graders. Failed: broke a rule, fell short, or a claimed action was contradicted. No result or not run: never counted as a pass. ${legendGrade(f)}`,
      },
      {
        term: "Claimed actions",
        text: `Checked in the company's own system only where it set up a read-only connection${effectsLegend}.`,
      },
      {
        term: "Seal",
        text: f.sealed
          ? `A SHA-256 fingerprint of the content: any change breaks it. Check it at ${VERIFY_ON_PAPER}. It shows the document is unchanged, not that the agent is safe or lawful.`
          : "No sealed report for this run.",
      },
    ],
    docsHref: READING_A_REPORT_HREF,
  };
}

/** Every sentence the guide can show, for the language rule's test. */
export function guideText(g: ReportGuide): string {
  return [
    g.summary,
    ...g.parts.flatMap((p) => [p.title, ...p.paragraphs]),
    g.scope,
    ...g.legend.map((l) => `${l.term}: ${l.text}`),
  ].join("\n");
}
