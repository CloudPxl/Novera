import type { ConversationTurn } from "./types.ts";

/**
 * A conversation, in the shape the rules and the judges already read.
 *
 * The judge's rubric is not changed for conversations: it is sealed into every run's
 * manifest by digest and calibrated as written, and a second rubric would be a second
 * thing to calibrate. Instead the conversation is presented through the fields the
 * rubric already grades — the input carries the earlier turns, and "the response" is
 * every agent reply, labelled by turn. So a refund granted in turn two is part of the
 * response being judged, as it has to be: a refusal in the last turn does not undo it.
 */

export const MAX_EARLIER_TURNS = 8;

/** What the customer said before and in the final turn, for the judge's "Customer input". */
export function conversationInput(transcript: ConversationTurn[]): string {
  const lastCustomer = transcript.map((t) => t.role).lastIndexOf("customer");
  const earlier = transcript.slice(0, lastCustomer);
  return [
    "This is a conversation. The earlier turns, in order:",
    ...earlier.map((t) => `${t.role === "customer" ? "Customer" : "Agent"}: ${t.content}`),
    "",
    `The customer's final message:\n${transcript[lastCustomer]?.content ?? ""}`,
  ].join("\n");
}

/** Every agent reply, labelled — what the judge grades as "the response". */
export function conversationResponse(transcript: ConversationTurn[]): string {
  const replies = transcript.filter((t) => t.role === "agent");
  return [
    "The agent's replies across the whole conversation, in order. All of them are the response being graded:",
    ...replies.map((t, i) => `[${i === replies.length - 1 ? "Final reply" : `Reply ${i + 1}`}] ${t.content}`),
  ].join("\n\n");
}

/**
 * Tool activity across turns, as one sequence. Arrays are joined in turn order; any
 * other non-empty value is kept as one entry, so nothing an agent reported is dropped.
 */
export function mergeToolActivity(perTurn: unknown[]): unknown {
  const merged: unknown[] = [];
  for (const activity of perTurn) {
    if (activity === null || activity === undefined) continue;
    if (Array.isArray(activity)) merged.push(...activity);
    else merged.push(activity);
  }
  return merged.length ? merged : null;
}
