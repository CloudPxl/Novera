import type { CaseRow } from "./case-table.tsx";

/**
 * The lenses a reviewer actually reaches for.
 *
 * Pass / fail / no result is an engineer's view: it sorts by what the run produced.
 * Someone deciding whether this agent can go in front of customers is asking different
 * questions — what could not be evidenced, what the agent claimed to *do*, where the
 * models could not agree, what broke since last time — and every one of those cuts
 * across all three verdicts.
 *
 * Each lens is computed from a stored field. None of them is a heuristic about what a
 * case "probably" is, because a filter that quietly includes the wrong scenario is
 * worse than no filter: it makes a reviewer believe they have seen the whole set.
 */
export const LENSES = [
  {
    key: "evidence",
    label: "No evidence",
    hint: "A pass was withheld because nothing evidenced the action the agent described.",
    match: (c: CaseRow) => c.evidenceGap !== null,
  },
  {
    key: "action",
    label: "Action claimed",
    hint: "The scenario expected something to change, so the verdict rested on more than the wording.",
    match: (c: CaseRow) => c.evidenceGap !== null || c.observation !== null,
  },
  {
    key: "contradicted",
    label: "Contradicted",
    hint: "Your own system disagreed with what the agent said it had done.",
    match: (c: CaseRow) => c.observation?.status === "contradicted",
  },
  {
    key: "disagreed",
    label: "Judges disagreed",
    hint: "Two models disagreed and a third could not settle it, so there is no verdict.",
    match: (c: CaseRow) => c.judgeAgreement === "unresolved" || c.judgeAgreement === "disputed",
  },
  {
    key: "sensitive",
    label: "Privacy or security",
    hint: "A scenario in one of those areas that did not pass.",
    match: (c: CaseRow) =>
      c.status !== "pass" && (c.category === "privacy" || c.category === "security"),
  },
  {
    key: "regression",
    label: "New since baseline",
    hint: "This passed in the run being compared against and does not pass now.",
    match: (c: CaseRow) => c.regression === true,
  },
  {
    key: "review",
    label: "Needs a person",
    hint: "Critical or high severity, and not a pass.",
    match: (c: CaseRow) =>
      c.status !== "pass" && (c.severity === "critical" || c.severity === "high"),
  },
] as const;

export type Lens = (typeof LENSES)[number]["key"];
