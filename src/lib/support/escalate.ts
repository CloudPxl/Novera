/**
 * Which questions a model must not answer on its own.
 *
 * This runs *before* the model is called, not after, so a consequential request never
 * receives a drafted answer that somebody might approve in a hurry. The model is not
 * asked to judge its own competence — that judgement is made here, by a rule a person
 * can read and argue with.
 *
 * The test is deliberately broad. A false escalation costs a human two minutes; a
 * wrongly automated answer about a refund, someone's personal data or a contract term
 * costs considerably more, and is exactly the failure this product sells evidence
 * against. We do not get to be careless about the thing we sell care about.
 */
export interface EscalationRule {
  /** Why no draft was written. Shown to the operator, not to the asker. */
  reason: string;
  /**
   * What the asker is told while they wait.
   *
   * Per category rather than one generic line, because a generic acknowledgement
   * leaves the question's premise standing. Someone asking us to guarantee an audit
   * outcome should not be met with silence on the guarantee — our own suite caught
   * exactly that (D10) and marked it a failure, correctly.
   */
  holdingLine: string;
  patterns: RegExp[];
}

export const ESCALATION_RULES: EscalationRule[] = [
  {
    reason: "Money: refunds, billing and pricing are decided by a person.",
    holdingLine:
      "Anything to do with money — refunds, invoices or what something costs — is decided by a person here, never automatically. Someone will come back to you on this.",
    patterns: [/\brefund/i, /\bchargeback/i, /\binvoice/i, /\bbilling\b/i, /\bdiscount/i, /\bcancel (my|the|our) (plan|subscription|account)/i, /\bprice (for|on)\b/i, /\bquote\b/i],
  },
  {
    reason: "Personal data: access, export and erasure requests go to a person.",
    holdingLine:
      "Requests about your personal data — access, export or deletion — are carried out by a person, and nothing has been done to your data by this reply. Someone will confirm what happens next.",
    // Widened after our own suite caught the gap (D05): "delete everything you hold
    // about me" matched none of the original patterns, so an erasure request was
    // answered from the documentation instead of being routed to a person. People do
    // not phrase this the way a regex author expects, and this is the one obligation
    // we least get to be sloppy about.
    patterns: [
      /\b(delete|erase|remove|wipe|purge)\b[^.?!]{0,40}\b(my|our|all|everything|any)\b/i,
      /\b(delete|erase|remove|forget)\b[^.?!]{0,20}\b(me|us)\b/i,
      /\berasure\b/i,
      /\bright to be forgotten/i,
      /\bforget me\b/i,
      /\bgdpr\b/i,
      /\bdata protection\b/i,
      /\bdpa\b/i,
      /\bsubprocessor/i,
      /\b(export|send me|give me|what do you hold|what data do you have)\b[^.?!]{0,30}\b(my|our|about me|about us)\b/i,
      /\bpersonal (data|information)\b/i,
    ],
  },
  {
    reason: "Legal and contractual questions are answered by a person.",
    holdingLine:
      "To be straightforward about the substance while you wait: Novera produces evidence that an agent was tested against named scenarios. It is not a certification and not a statement of legal compliance, so it is not something we can offer a guarantee on. A person will pick up the rest of your question.",
    patterns: [/\bcontract\b/i, /\bliabilit/i, /\bindemnif/i, /\bsla\b/i, /\bterms\b/i, /\bwarrant/i, /\blegal\b/i, /\bcertif(y|ication|ied)\b/i, /\bguarantee/i],
  },
  {
    reason: "Security reports are seen by a person immediately.",
    holdingLine:
      "Security reports go straight to a person rather than through any automated reply. Someone will be in touch shortly.",
    patterns: [/\bvulnerab/i, /\bbreach\b/i, /\bsecurity incident/i, /\bexploit/i, /\bpenetration test/i, /\bcve-\d/i],
  },
];

export interface EscalationCheck {
  escalate: boolean;
  reason: string | null;
  holdingLine: string | null;
}

export const DEFAULT_HOLDING_LINE =
  "Thank you — that has reached us. A person reads every message here, so you will get a reply from a human rather than an automatic one.";

export function checkEscalation(message: string): EscalationCheck {
  for (const rule of ESCALATION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(message))) {
      return { escalate: true, reason: rule.reason, holdingLine: rule.holdingLine };
    }
  }
  return { escalate: false, reason: null, holdingLine: null };
}

/**
 * An answer, with the pages it rests on.
 *
 * Shared by the endpoint that Novera tests and the email that actually goes out, so
 * that what we grade is what we send. They were different: the drafter produced
 * citations, the operator saw them, and the email dropped them — a reply arriving with
 * no indication of what it was based on. Our own suite caught it (D01).
 */
export function withSources(body: string, citations: string[], baseUrl?: string): string {
  if (citations.length === 0) return body;
  const root = (baseUrl ?? "").replace(/\/+$/, "");
  const list = citations.map((slug) => (root ? `${root}/docs/${slug}` : `/docs/${slug}`)).join("\n");
  return `${body}\n\nThis answer is based on:\n${list}`;
}
