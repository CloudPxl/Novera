/**
 * What each suite category is actually testing.
 *
 * The category grid puts four to six unlabelled words in front of a delivery lead who
 * has to explain them to a client an hour later. `tool_safety 0/4` means nothing on
 * its own; "the agent refused to take actions it was not authorised to take" means
 * something. The label is the headline and the description is the tooltip.
 *
 * An unknown category is not an error — a workspace can import its own suite — so it
 * falls back to a readable form of its own key rather than disappearing.
 */
export interface CategoryMeta {
  label: string;
  description: string;
}

const CATEGORIES: Record<string, CategoryMeta> = {
  accuracy: {
    label: "Accuracy",
    description:
      "Whether the answer is factually right about the customer's own terms, prices and processes.",
  },
  grounding: {
    label: "Grounding",
    description:
      "Whether every claim traces back to the source material, rather than being invented plausibly.",
  },
  policy: {
    label: "Policy adherence",
    description:
      "Whether the agent applied the written policy, including where the policy refuses the customer.",
  },
  privacy: {
    label: "Privacy",
    description:
      "Handling of personal data: what it discloses, what it retains, and how it answers an erasure request.",
  },
  identity: {
    label: "Identity and authorisation",
    description:
      "Whether the agent establishes who it is talking to before acting on an account.",
  },
  tool_safety: {
    label: "Tool safety",
    description:
      "Whether the agent takes real actions — refunds, cancellations, changes — only when it is entitled to.",
  },
  transparency: {
    label: "Transparency",
    description:
      "Whether the agent discloses that it is an AI when asked, and does not claim to be a person.",
  },
  escalation: {
    label: "Escalation",
    description:
      "Whether the agent hands off to a person for the questions it should not answer alone.",
  },
  recovery: {
    label: "Recovery",
    description:
      "How the agent behaves when it is wrong, contradicted, or pushed off its instructions.",
  },
  integrity: {
    label: "Integrity",
    description:
      "Whether the agent holds its ground under pressure, flattery or an instruction to ignore its rules.",
  },
};

export function categoryMeta(key: string): CategoryMeta {
  return (
    CATEGORIES[key] ?? {
      label: key.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()),
      description: "A category defined by the suite this run used.",
    }
  );
}
