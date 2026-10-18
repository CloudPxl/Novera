import type { Metadata } from "next";
import { pageMetadata } from "../../../lib/seo/site.ts";

/**
 * The solution pages: their addresses, titles and descriptions in one list, so the index, the
 * cross-links and every page's `metadata` read the same words, and `tests/solutions.test.ts`
 * can check them without rendering a page.
 *
 * Relative imports only: the test runner loads this file without the `@/` alias.
 */

export type SolutionSlug = "eu-ai-act" | "black-box-testing" | "agency" | "regulatory-mapping";

export interface Solution {
  slug: SolutionSlug;
  path: `/solutions/${SolutionSlug}`;
  /** Short label for links and breadcrumbs. */
  name: string;
  /** The page title; the layout template adds the site name. */
  title: string;
  description: string;
  /** One sentence for the index and the cross-links. */
  summary: string;
  /** Who it is for (an audience page), or a reference anyone can consult. The index lists them apart. */
  kind: "audience" | "reference";
}

export const SOLUTIONS: readonly Solution[] = [
  {
    slug: "eu-ai-act",
    path: "/solutions/eu-ai-act",
    name: "EU AI Act evidence",
    title: "EU AI Act testing evidence for AI support agents",
    description:
      "Black-box tests of an AI support agent you operate, each verdict filed under the EU AI Act and GDPR references it bears on, in a sealed, dated report.",
    summary:
      "Scenarios filed under AI Act Articles 13, 14, 15 and 50(1) and the GDPR, sealed into a dated report your counsel can read.",
    kind: "audience",
  },
  {
    slug: "black-box-testing",
    path: "/solutions/black-box-testing",
    name: "Black-box agent testing",
    title: "Black-box testing for AI support agents over HTTP",
    description:
      "Send a versioned scenario suite to your agent's HTTP endpoint: rules, a read-back from your own system, then two models from different vendors. Errors never pass.",
    summary:
      "Rules, then a read-back from your own system, then two models from different vendors. Missing evidence is never a pass.",
    kind: "audience",
  },
  {
    slug: "agency",
    path: "/solutions/agency",
    name: "For agencies",
    title: "AI agent testing for agencies: a sealed report per client",
    description:
      "One workspace per client, scheduled re-runs, a release gate, and a sealed SHA-256 report each client can check, reissued with your reviewers' findings.",
    summary:
      "One workspace per client, scheduled re-runs and a release gate, and a sealed report for each client agent you ship.",
    kind: "audience",
  },
  {
    slug: "regulatory-mapping",
    path: "/solutions/regulatory-mapping",
    name: "Regulatory mapping",
    title: "EU AI Act and GDPR mapping of agent test scenarios",
    description:
      "Each EU AI Act and GDPR reference the Novera test suite carries, the scenarios filed under it and how each is checked. A reference matrix, not a legal opinion.",
    summary:
      "Every AI Act and GDPR reference in the suite, the scenarios filed under it, and how each one is checked — counted from the suite itself.",
    kind: "reference",
  },
];

export const SOLUTIONS_INDEX = {
  path: "/solutions",
  title: "Solutions: AI Act evidence, black-box testing, agencies",
  description:
    "Where Novera fits: testing evidence for the EU AI Act duties of a support agent, black-box behavioural testing over HTTP, and sealed client reports for agencies.",
} as const;

export function solution(slug: SolutionSlug): Solution {
  const found = SOLUTIONS.find((s) => s.slug === slug);
  if (!found) throw new Error(`Unknown solution page: ${slug}`);
  return found;
}

export function solutionMetadata(slug: SolutionSlug): Metadata {
  const s = solution(slug);
  return pageMetadata({ title: s.title, description: s.description, path: s.path });
}

export function solutionsIndexMetadata(): Metadata {
  return pageMetadata({ title: SOLUTIONS_INDEX.title, description: SOLUTIONS_INDEX.description, path: SOLUTIONS_INDEX.path });
}

/** The suite a new run uses, as the AI Act page names it. Checked against data/suites by the test. */
export const SUITE = { name: "eu-support v6", version: 6, scenarios: 49 } as const;

/**
 * How many scenarios of {@link SUITE} carry each EU AI Act reference in `duty_refs`, and how many
 * carry any AI Act or any GDPR reference. Counted from the suite file, and re-counted by
 * `tests/solutions.test.ts` so a new suite version cannot leave this page stating old figures.
 */
export const AI_ACT_REFS = {
  "EU AI Act Art. 50(1)": 1,
  "EU AI Act Art. 13": 9,
  "EU AI Act Art. 14": 11,
  "EU AI Act Art. 15": 19,
} as const;
export const AI_ACT_SCENARIOS = 36;
export const GDPR_SCENARIOS = 22;
