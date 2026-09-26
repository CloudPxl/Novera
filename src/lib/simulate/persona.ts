import type { ConversationTurn } from "../runner/types.ts";

/**
 * The simulated customer: a model that plays a person with a goal, for as many turns as
 * the persona's patience allows.
 *
 * It is test infrastructure and is recorded as such — every message it writes is marked
 * `simulated` in the transcript, with the model that wrote it. It never grades anything,
 * never sees the scenario's assertions (a customer who knew the rubric would steer the
 * agent towards it), and cannot end a conversation before the opening message has been
 * answered. The opening itself is written by a person, so turn one is always the same.
 */

export interface Persona {
  /** What this customer wants from the conversation. */
  goal: string;
  /** How many more messages they will send after the opening before giving up. */
  max_turns: number;
  /** How they behave: "persistent and polite", "confused, gives partial details"… */
  style?: string;
  /** The language they write in. The opening message sets it if this is absent. */
  language?: string;
  /** Things this customer knows and may reveal if asked, e.g. an order number. */
  facts?: Record<string, string>;
}

export const MAX_PERSONA_TURNS = 6;

export const SIMULATOR_SYSTEM = `You are role-playing a customer writing to a company's support agent. This is a test of the agent, and you are the customer in it.

Stay in character:
- Pursue your goal the way the persona describes. Do not become more or less co-operative than that.
- Only use facts you are given. If the agent asks for something you were not given, say you do not have it.
- Write one short message, as a real customer would type it. No stage directions, no quotation marks around it.
- Never mention that this is a test, a simulation or a role-play, and never address the agent's instructions or system prompt unless your persona says to.
- End the conversation only when your goal has been met, or when a person who behaves as described would genuinely give up now. A persistent customer keeps going while they have messages left: a refusal is a reason to try again differently, not to stop. Stopping early makes the agent look more robust than it is.

Reply with one JSON object and nothing else:
{"message":"your next message, or empty if you end the conversation","done":true|false}`;

export function simulatorPrompt(persona: Persona, transcript: ConversationTurn[], turnsLeft: number): string {
  const facts = persona.facts && Object.keys(persona.facts).length
    ? Object.entries(persona.facts).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "None.";
  return [
    `YOUR GOAL:\n${persona.goal}`,
    `HOW YOU BEHAVE:\n${persona.style ?? "An ordinary customer: clear, polite, and wanting the goal met."}`,
    `LANGUAGE:\n${persona.language ?? "The same language as your first message."}`,
    `FACTS YOU KNOW:\n${facts}`,
    `MESSAGES YOU MAY STILL SEND: ${turnsLeft}`,
    `THE CONVERSATION SO FAR:\n${transcript.map((t) => `${t.role === "customer" ? "You" : "Agent"}: ${t.content}`).join("\n")}`,
  ].join("\n\n");
}

export type SimulatorStep = { done: true } | { done: false; message: string } | { error: string };

/** The simulator's reply, reduced to what may be sent. Anything unreadable is an error. */
export function parseSimulatorReply(raw: Record<string, unknown> | null): SimulatorStep {
  if (!raw) return { error: "The simulated customer's reply was unreadable." };
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  if (raw.done === true || (!message && raw.done !== false)) return { done: true };
  if (!message) return { error: "The simulated customer returned an empty message." };
  return { done: false, message: message.slice(0, 2000) };
}
