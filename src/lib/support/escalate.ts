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
  reason: string;
  patterns: RegExp[];
}

export const ESCALATION_RULES: EscalationRule[] = [
  {
    reason: "Money: refunds, billing and pricing are decided by a person.",
    patterns: [/\brefund/i, /\bchargeback/i, /\binvoice/i, /\bbilling\b/i, /\bdiscount/i, /\bcancel (my|the|our) (plan|subscription|account)/i, /\bprice (for|on)\b/i, /\bquote\b/i],
  },
  {
    reason: "Personal data: access, export and erasure requests go to a person.",
    patterns: [/\bdelete (my|our|all) (data|account|information)/i, /\berasure\b/i, /\bright to be forgotten/i, /\bgdpr\b/i, /\bdata protection\b/i, /\bdpa\b/i, /\bsubprocessor/i, /\bexport (my|our) data/i],
  },
  {
    reason: "Legal and contractual questions are answered by a person.",
    patterns: [/\bcontract\b/i, /\bliabilit/i, /\bindemnif/i, /\bsla\b/i, /\bterms\b/i, /\bwarrant/i, /\blegal\b/i, /\bcertif(y|ication|ied)\b/i, /\bguarantee/i],
  },
  {
    reason: "Security reports are seen by a person immediately.",
    patterns: [/\bvulnerab/i, /\bbreach\b/i, /\bsecurity incident/i, /\bexploit/i, /\bpenetration test/i, /\bcve-\d/i],
  },
];

export interface EscalationCheck {
  escalate: boolean;
  reason: string | null;
}

export function checkEscalation(message: string): EscalationCheck {
  for (const rule of ESCALATION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(message))) {
      return { escalate: true, reason: rule.reason };
    }
  }
  return { escalate: false, reason: null };
}
