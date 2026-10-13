/**
 * The legal build brief of 2026-10-13, section by section: what exists in the code for each,
 * where, and what it still waits on. Rendered on the staff page /readiness ("Brief tracker"), and
 * the same table is in docs/LEGAL-FRAMEWORK.md — tests/launch-readiness.test.ts fails if the two
 * list different sections, so editing one means editing the other.
 *
 * Not legal advice, and nothing here makes a draft final. A row's `status` is what the code
 * does; whether that is legally sufficient is counsel's answer, and `counsel` names the question.
 * Pure data: no environment is read. The live state of each thing is on the Status tab.
 */

/** What a row's status means. `built` is code; every other value is waiting on someone. */
export type TrackerStatus =
  /** The code exists and is tested. Counsel may still have a question about it. */
  | "built"
  /** A text exists as a draft for counsel; nothing about it is in force. */
  | "draft"
  /** A decision is recorded and the code follows it; counsel is asked to confirm it. */
  | "decision"
  /** Waiting on a fact or an action only David can supply. */
  | "david"
  /** Waiting on the accountant. */
  | "accountant";

export interface TrackerRow {
  /** The brief's section, exactly as the first column of the table in docs/LEGAL-FRAMEWORK.md. */
  brief: string;
  /** What exists, in the doc's words. */
  exists: string;
  /** Files, migrations or functions that enforce it. Empty where nothing in the code does. */
  where: string[];
  status: TrackerStatus;
  /** The status column of the doc, verbatim. */
  statusText: string;
  /** Question numbers in docs/LEGAL-COUNSEL-QUESTIONS.md. */
  counsel: number[];
}

export const BRIEF_DATE = "2026-10-13";

export const BRIEF_TRACKER: readonly TrackerRow[] = [
  {
    brief: "§2 Article 1203 acceptance",
    exists: "Three separate checkboxes, none pre-ticked: the documents; express acceptance of Terms §§2, 8, 10, 12, 14, 15, 17, each listed with what it covers; business purpose and authority. Each text is fingerprinted, and so is the unusual-clause text on its own.",
    where: ["src/lib/legal/contract.ts", "src/app/(app)/settings/billing/terms-form.tsx"],
    status: "built",
    statusText: "Built; wording for counsel (question 36)",
    counsel: [36],
  },
  {
    brief: "§3 B2B gate",
    exists: "Legal name, registered address, country (validated with the runtime's Intl region data), optional VAT number recorded as declared and never marked validated, signer name and title.",
    where: ["src/lib/legal/contract.ts", "0068"],
    status: "built",
    statusText: "Built; adequacy for counsel (37)",
    counsel: [37],
  },
  {
    brief: "§4 Consumer withdrawal",
    exists: "Not offered: B2B only. No consumer checkout and no 14-day copy.",
    where: ["data/legal/terms.ts", "data/legal/refunds.ts"],
    status: "decision",
    statusText: "Decision recorded; counsel to confirm",
    counsel: [5, 6],
  },
  {
    brief: "§5 Renewal, cancellation, refunds",
    exists: "Terms §10 and the Refunds draft describe what the code does: monthly renewal, cancellation at period end through Stripe's portal, a plan starts only on Stripe's signed webhook.",
    where: ["data/legal/terms.ts", "data/legal/refunds.ts"],
    status: "draft",
    statusText: "Draft",
    counsel: [],
  },
  {
    brief: "§6–7 AI Act boundary and report notice",
    exists: "Standing notice: on every report's cover and in full, in the CSV, Markdown, JSON (notice, outside the hashed payload) and JUnit exports, beside the \"Open the client report\" link, and in the AI Testing Scope notice. New reports' sealed limitations also say \"not a statutory conformity assessment; Novera is not a notified body\".",
    where: ["src/lib/legal/notices.ts"],
    status: "built",
    statusText: "Built",
    counsel: [39],
  },
  {
    brief: "§8–10, §13–14, §18–19 Clauses",
    exists: "Proposed in Terms 0.2: customer responsibility, model variance, data minimisation, BYOK, indemnities, no indemnity for regulatory fines, liability capped at three months' fees, Romanian law and the Bucharest courts. No arbitration.",
    where: ["data/legal/terms.ts"],
    status: "draft",
    statusText: "Draft (counsel 38, 41)",
    counsel: [38, 41],
  },
  {
    brief: "§11–12 Roles, DPA, sub-processors",
    exists: "The DPA proposes a role per activity. Annex 2 and the Sub-processors page render from one register.",
    where: ["data/legal/dpa.ts", "data/legal/register.ts"],
    status: "draft",
    statusText: "Draft",
    counsel: [41],
  },
  {
    brief: "§15 Imprint (Law 365/2002 art. 5, Law 31/1990 art. 74)",
    exists: "One entity record, all null; the Imprint renders placeholders until it is filled.",
    where: ["data/legal/entity.ts", "data/legal/imprint.ts"],
    status: "david",
    statusText: "Waiting on David",
    counsel: [4],
  },
  {
    brief: "§16 Stripe readiness",
    exists: "Live checkout refuses while any contract document is a draft or a company detail is missing.",
    where: ["livePublicationProblems (src/lib/legal/contract.ts)"],
    status: "built",
    statusText: "Built",
    counsel: [],
  },
  {
    brief: "§17 VAT reverse charge",
    exists: "Not automated. Stripe Tax stays off.",
    where: [],
    status: "accountant",
    statusText: "Accountant (42)",
    counsel: [42],
  },
  {
    brief: "§20.1 Acceptance ledger",
    exists: "contract_acceptances: append-only for the service role too, written only by the server after the owner/admin check, readable by owner/admin/auditor, erased with the workspace. No IP column; vat_id_verified and marketing_consent are fixed false. Downloadable record; audit line contract.accepted.",
    where: ["0068", "src/lib/legal/acceptance-store.ts", "/settings/billing/acceptance/<id>"],
    status: "built",
    statusText: "Built",
    counsel: [40],
  },
  {
    brief: "§20.2 Checkout gate",
    exists: "startCheckout refuses a workspace without an acceptance of the current texts, before any Stripe object. The browser still sends only a plan key. The Stripe customer takes the accepted legal name, and the session carries contract_acceptance_id in its metadata.",
    where: ["src/lib/billing/actions.ts"],
    status: "built",
    statusText: "Built",
    counsel: [],
  },
  {
    brief: "§20.3 Billing configuration",
    exists: "A production deployment refuses a Stripe test key (billingConfig). The Stripe variables are to be removed from Production and kept in Preview only.",
    where: ["src/lib/billing/config.ts"],
    status: "david",
    statusText: "One action for David",
    counsel: [],
  },
  {
    brief: "§20.4 Terminology",
    exists: "Novera's own surfaces changed; customer policy text is never touched. The report language rule and the legal tests refuse certified / compliant / approved by a regulator.",
    where: ["src/lib/report/language.ts", "src/lib/report/export.ts"],
    status: "built",
    statusText: "Built",
    counsel: [39],
  },
  {
    brief: "§20.5 Publication controls",
    exists: "/legal/* stays noindex with the draft banner unless the document is approved, has an approval record, matches its frozen archived text, and the company details are complete. No public page links to a draft or says \"you agree to the terms\" (tested).",
    where: ["src/lib/legal/publication.ts", "data/legal/archive.ts"],
    status: "built",
    statusText: "Built",
    counsel: [],
  },
  {
    brief: "§20.6 Data-flow register",
    exists: "One register (status, data classes, location only where verified, transfer placeholder, who configured it). Machine-readable at /legal/subprocessors.json, where \"in use\" is read from the deployment's configuration.",
    where: ["data/legal/register.ts", "/legal/subprocessors.json"],
    status: "built",
    statusText: "Built",
    counsel: [19, 33],
  },
  {
    brief: "§20.7 Retention schedule",
    exists: "Every period the code enforces, each tested against its migration or constant; placeholders where counsel, the accountant or Supabase must answer. The Privacy Notice renders it.",
    where: ["data/legal/retention.ts"],
    status: "built",
    statusText: "Built",
    counsel: [3, 13, 40],
  },
];

/** The sections the brief numbers that are not table rows here but have their own tab. */
export const BRIEF_ELSEWHERE: ReadonlyArray<{ brief: string; tab: "gates" | "decisions" }> = [
  { brief: "§22", tab: "decisions" },
  { brief: "§23", tab: "gates" },
];

/** Every § number a label mentions, ranges expanded: "§8–10, §13–14" → 8, 9, 10, 13, 14. */
export function sectionsIn(label: string): string[] {
  const out: string[] = [];
  for (const m of label.matchAll(/§(\d+(?:\.\d+)?)(?:[–-](\d+))?/g)) {
    if (m[2] && !m[1].includes(".")) {
      for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(String(n));
    } else {
      out.push(m[1]);
    }
  }
  return out;
}
