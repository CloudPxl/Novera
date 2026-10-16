/**
 * How Novera reads the EU AI Act references a scenario carries (for example "EU AI Act Art. 14").
 *
 * Two different things sit under the same prefix, and a reader who takes them for one will take
 * Novera to be saying more than it does:
 *
 * - Article 50 sets transparency obligations for AI systems that interact directly with people,
 *   for example telling a person that they are dealing with an AI system. Novera tests whether
 *   the agent says so.
 * - Articles 12 (record-keeping), 13 (transparency and information to deployers), 14 (human
 *   oversight) and 15 (accuracy, robustness and cybersecurity) are requirements for high-risk AI
 *   systems. Most customer-support agents are not high-risk, so Novera references them as
 *   engineering benchmarks for logging, escalation to a person and robustness: not as duties the
 *   operator necessarily has.
 *
 * Whether a system is high-risk is a legal determination for its operator and counsel; nothing
 * here makes it. Not legal advice. No application dates are stated: the framework files hold
 * none for these articles (src/lib/legal/framework.ts), and a date belongs to counsel's text.
 *
 * Pure, so the mapping page and the glossary read the same words (src/lib/explainability/glossary.ts,
 * src/app/solutions/regulatory-mapping/page.tsx). It is the explanation layer only: the reference
 * strings themselves are the suite's, and never rewritten here.
 */

export type AiActRole = "transparency" | "high-risk";

export interface AiActFraming {
  /** The article number, as the suite writes it without its paragraph: "50", "14". */
  article: string;
  role: AiActRole;
  /** What the article is about, in a few words. */
  topic: string;
  /** One or two sentences for a reference's card: what Novera's scenarios under it are, and are not. */
  sentence: string;
}

const highRisk = (article: string, topic: string, benchmarkFor: string): string =>
  `Article ${article} (${topic}) is a requirement for high-risk AI systems. Most customer-support agents are not high-risk, so Novera uses it as an engineering benchmark for ${benchmarkFor}, not as a duty you necessarily have.`;

export const AI_ACT_FRAMINGS: readonly AiActFraming[] = [
  { article: "12", role: "high-risk", topic: "record-keeping", sentence: highRisk("12", "record-keeping", "logging") },
  {
    article: "13",
    role: "high-risk",
    topic: "transparency and information to deployers",
    sentence: highRisk("13", "transparency and information to deployers", "clear, grounded answers"),
  },
  { article: "14", role: "high-risk", topic: "human oversight", sentence: highRisk("14", "human oversight", "escalation to a person") },
  {
    article: "15",
    role: "high-risk",
    topic: "accuracy, robustness and cybersecurity",
    sentence: highRisk("15", "accuracy, robustness and cybersecurity", "robustness"),
  },
  {
    article: "50",
    role: "transparency",
    topic: "transparency obligations for systems that interact with people",
    sentence:
      "Article 50 sets transparency obligations for AI systems that interact directly with people, for example telling a person that they are dealing with an AI system. Novera tests whether the agent discloses that.",
  },
];

/** The pieces of the general explanation, one sentence each, for the glossary and the mapping page. */
export const AI_ACT_FRAMING_SUMMARY = {
  transparency:
    "Article 50 sets transparency obligations for AI systems that interact directly with people, and Novera tests whether the agent discloses that it is an AI.",
  highRisk:
    "Articles 12 (record-keeping), 13 (transparency to deployers), 14 (human oversight) and 15 (accuracy, robustness and cybersecurity) are requirements for high-risk AI systems.",
  benchmark:
    "Most customer-support agents are not high-risk, so Novera references those four as engineering benchmarks for logging, escalation to a person and robustness, not as duties the operator necessarily has.",
  determination: "Whether a system is high-risk is a legal determination for the operator and counsel.",
} as const;

/** The framing for a reference such as "EU AI Act Art. 50(1)", or null for anything that is not an AI Act article Novera frames. */
export function aiActFramingFor(ref: string): AiActFraming | null {
  const match = /^EU AI Act Art\. (\d+)/.exec(ref);
  return match ? (AI_ACT_FRAMINGS.find((f) => f.article === match[1]) ?? null) : null;
}
