import type { RoutedChat } from "../router/execute.ts";
import { extractJsonObject } from "../judge/parse.ts";
import { checkEscalation } from "./escalate.ts";

/**
 * Drafting a support answer from the published documentation and nothing else.
 *
 * The same rule the conformity suite grades a customer's agent on — answer only from
 * approved documentation, and say so when it does not cover the question — applies to
 * our own support agent. It would be difficult to sell evidence of source grounding
 * while running an unsourced support bot.
 *
 * So: every answer must cite the pages it rests on, each cited slug is checked against
 * a real published page, and an answer that cites nothing is not a draft. Nothing here
 * is ever sent automatically.
 */
export interface DocPage {
  slug: string;
  title: string;
  body: string;
}

export interface DraftedAnswer {
  answered: boolean;
  body: string | null;
  citations: string[];
  model: string | null;
  /** Why there is no draft. Shown to the operator, never to the person who asked. */
  reason: string | null;
}

export const SUPPORT_SYSTEM = `You draft replies to questions about a product called Novera. You are drafting for a human to review; nothing you write is sent without their approval.

You may use ONLY the documentation pages given to you. They are the whole of what you know.

Rules:
- If the pages answer the question, answer it plainly and cite every page you used by its slug.
- If the pages do not answer the question, say so. Do not reason from general knowledge about similar products, and do not guess at a plausible answer.
- Never state a price, a contractual commitment, a security guarantee or a compliance claim that is not written verbatim in the pages.
- Never invent a slug. Cite only slugs from the list you were given.
- Write three short paragraphs at most. No greeting, no sign-off — a person adds those.

Reply with a single JSON object and nothing else:
{"answered":true|false,"answer":"the reply text, or empty when answered is false","citations":["slug"],"missing":"what the docs do not cover, when answered is false"}`;

function buildPrompt(question: string, pages: DocPage[]): string {
  const corpus = pages
    .map((p) => `--- slug: ${p.slug}\ntitle: ${p.title}\n\n${p.body}`)
    .join("\n\n");

  return [
    `Documentation pages available to you:\n\n${corpus}`,
    `Slugs you may cite: ${pages.map((p) => p.slug).join(", ")}`,
    `The question:\n${question}`,
  ].join("\n\n---\n\n");
}

export async function draftAnswer(args: {
  chat: RoutedChat;
  question: string;
  pages: DocPage[];
}): Promise<DraftedAnswer> {
  const { chat, question, pages } = args;

  const empty = { body: null, citations: [], model: null };

  // Checked again here, not only at the form: this function must be safe to call
  // from anywhere, including a future bulk reprocessing of the queue.
  const escalation = checkEscalation(question);
  if (escalation.escalate) {
    return { ...empty, answered: false, reason: escalation.reason };
  }

  if (pages.length === 0) {
    return { ...empty, answered: false, reason: "There is no published documentation to answer from." };
  }

  let response: Awaited<ReturnType<RoutedChat>>;
  try {
    response = await chat("draft", {
      system: SUPPORT_SYSTEM,
      messages: [{ role: "user", content: buildPrompt(question, pages) }],
      maxTokens: 900,
      temperature: 0,
    });
  } catch (error) {
    return {
      ...empty,
      answered: false,
      reason: `No model could draft a reply: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const model = `${response.servedBy.connection}/${response.servedBy.model}`;
  const parsed = extractJsonObject(response.text) as Record<string, unknown> | null;

  if (!parsed) {
    return { ...empty, model, answered: false, reason: "The model did not return a readable draft." };
  }

  if (parsed.answered !== true) {
    const missing = typeof parsed.missing === "string" && parsed.missing.trim()
      ? parsed.missing.trim()
      : "The published documentation does not cover this question.";
    return { ...empty, model, answered: false, reason: missing };
  }

  const body = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  if (!body) {
    return { ...empty, model, answered: false, reason: "The draft came back empty." };
  }

  const known = new Set(pages.map((p) => p.slug));
  const claimed = Array.isArray(parsed.citations)
    ? parsed.citations.filter((c): c is string => typeof c === "string").map((c) => c.trim())
    : [];
  const citations = [...new Set(claimed.filter((slug) => known.has(slug)))];
  const invented = claimed.filter((slug) => !known.has(slug));

  if (invented.length > 0) {
    // A fabricated source is worse than no answer: it looks checkable and is not.
    return {
      ...empty,
      model,
      answered: false,
      reason: `The draft cited pages that do not exist (${invented.join(", ")}), so it was discarded.`,
    };
  }

  if (citations.length === 0) {
    return {
      ...empty,
      model,
      answered: false,
      reason: "The draft cited no documentation, so there is nothing to check it against.",
    };
  }

  return { answered: true, body, citations, model, reason: null };
}
