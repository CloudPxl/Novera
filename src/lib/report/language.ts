/**
 * The words a customer is allowed to read on a Novera document.
 *
 * Everything this product is worth rests on one sentence: *evidence of testing, not a
 * legal certification*. That sentence is easy to write in a limitations block and easy
 * to undo three screens later with a heading that says "compliant". Copy drifts because
 * nobody owns it, and the drift is always in the same direction — towards the flattering
 * word, because the flattering word is the one that sells.
 *
 * So the vocabulary is a rule with a test behind it rather than a convention.
 *
 * Permitted, and preferred, because each says exactly how much is known:
 *   verified · not verified · no evidence available · contradicted by your own system ·
 *   the models disagreed · outside the scope of this report · test data
 *
 * Refused anywhere a customer can read it:
 *   certified · compliant · zero risk · safe · guaranteed
 *
 * The rule is about *claims*, not words. "This is not a statement of legal compliance"
 * has to remain sayable — it is the most important sentence in the document — so a
 * match inside a negated clause is allowed and everything else is not.
 */

export interface LanguageFinding {
  line: number;
  text: string;
  matched: string;
  why: string;
}

interface Rule {
  pattern: RegExp;
  why: string;
}

const RULES: Rule[] = [
  {
    pattern: /\b(?:is|are|was|were|being|fully|now|remains?)\s+(?:fully\s+)?(?:certified|compliant|conformant)\b/gi,
    why: "Novera evidences testing; it does not certify anyone or find them compliant.",
  },
  {
    pattern: /\b(?:certifies|certifying|certification of|we certify|this certifies)\b/gi,
    why: "A report is evidence of testing, never a certificate.",
  },
  {
    pattern: /\bzero[- ]risk\b|\bno risk\b|\brisk[- ]free\b/gi,
    why: "No evaluation establishes the absence of risk; it establishes what was tested.",
  },
  {
    pattern: /\b(?:completely|entirely|totally|perfectly)\s+safe\b|\bis\s+safe\b|\byour data is safe\b/gi,
    why: "Safety is not a finding a scenario suite can produce.",
  },
  {
    pattern: /\b(?:guarantees?|guaranteed|guaranteeing)\b/gi,
    why: "A guarantee is a promise about the future; a report describes one dated run.",
  },
  {
    pattern: /\b(?:ensures?|ensuring)\s+compliance\b|\bmakes you compliant\b|\bcompliance guarantee\b/gi,
    why: "Compliance is the customer's duty and their lawyer's judgement, not our output.",
  },
  {
    pattern: /\b100%\s+(?:accurate|safe|reliable|compliant)\b|\bfully\s+(?:secure|protected)\b/gi,
    why: "An absolute claim cannot be supported by a finite suite of scenarios.",
  },
];

/**
 * Whether a match sits inside a clause that denies it.
 *
 * Deliberately generous. A false negative here is a sentence a person still has to
 * write carefully; a false positive is a rule that cries wolf until someone switches
 * it off, and a switched-off rule protects nothing.
 */
function negated(sentence: string, index: number): boolean {
  const before = sentence.slice(0, index).toLowerCase();
  return /\b(?:not|never|no|cannot|can't|isn't|aren't|without|nor|rather than|instead of|does not|do not|nothing)\b[^.]*$/.test(
    before,
  );
}

/** Splits into sentences, keeping each one's offset so negation is judged locally. */
function sentences(line: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  let start = 0;
  const re = /[.!?;:]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push({ text: line.slice(start, m.index + 1), offset: start });
    start = m.index + m[0].length;
  }
  out.push({ text: line.slice(start), offset: start });
  return out;
}

export function scanCustomerLanguage(source: string): LanguageFinding[] {
  const findings: LanguageFinding[] = [];

  source.split("\n").forEach((line, i) => {
    for (const { text, offset } of sentences(line)) {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = rule.pattern.exec(text)) !== null) {
          if (negated(text, match.index)) continue;
          findings.push({
            line: i + 1,
            text: line.trim().slice(0, 120),
            matched: match[0],
            why: rule.why,
          });
        }
        void offset;
      }
    }
  });

  return findings;
}
