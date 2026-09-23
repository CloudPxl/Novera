import { validateSuite } from "../suites/validate.ts";
import type { Suite, SuiteCase } from "../runner/types.ts";

/**
 * Turning approved drafts into a suite version.
 *
 * The one thing this must never do is change a version that already exists. A suite
 * version decides what every score that cites it is out of; a report issued last month
 * verifies against the cases that were in it then. So promotion always writes a new
 * version, and an existing one is read, never touched.
 *
 * The second thing it must never do is let two scenarios share an id. A duplicate id
 * puts two different tests under one name in a client's document, and the second reads
 * as a regression of the first. That is refused here rather than resolved by renaming,
 * because renaming would break the link back to the draft a person approved.
 */

export interface PromotionInput {
  key: string;
  name: string;
  version: number;
  /** Cases carried from the version being extended. Empty when starting fresh. */
  baseCases: SuiteCase[];
  approved: Array<{ draftId: string; scenario: SuiteCase }>;
}

export type Promotion =
  | { ok: true; suite: Suite; draftIds: string[] }
  | { ok: false; errors: string[] };

export function buildPromotedSuite(input: PromotionInput): Promotion {
  const errors: string[] = [];

  if (input.approved.length === 0) {
    errors.push("No approved scenarios were given, so there is nothing to promote.");
  }

  const seen = new Map<string, string>();
  for (const c of input.baseCases) seen.set(c.id, "the version being extended");

  for (const { draftId, scenario } of input.approved) {
    const previous = seen.get(scenario.id);
    if (previous) {
      errors.push(
        `Case id ${scenario.id} is already used by ${previous}. `
        + "Reject this draft and draft it again rather than renaming it, so the case in the "
        + "suite is the one someone approved.",
      );
      continue;
    }
    seen.set(scenario.id, `draft ${draftId}`);
  }

  if (errors.length) return { ok: false, errors };

  const cases = [...input.baseCases, ...input.approved.map((a) => a.scenario)];

  // The same validator that guards an import. A suite assembled here must be one a
  // customer could also have uploaded; if it is not, something is wrong with the
  // assembly and not with the file format.
  const validated = validateSuite({
    key: input.key, name: input.name, version: input.version, cases,
  });
  if (!validated.ok) return { ok: false, errors: validated.errors };

  return { ok: true, suite: validated.suite, draftIds: input.approved.map((a) => a.draftId) };
}

/**
 * The expectations a suite already covers, for showing a drafting model what not to
 * repeat. Expectations rather than inputs: a model shown the existing prompts
 * paraphrases them back, and a paraphrase is a duplicate wearing coverage's clothes.
 */
export function coveredBehaviours(cases: SuiteCase[]): string[] {
  return cases.map((c) => `${c.obligation}: ${c.expected_behavior}`);
}
