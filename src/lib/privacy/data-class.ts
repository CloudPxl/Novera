import { redact } from "../redact/pii.ts";

/**
 * What kind of data a model request carries, and which providers may receive it.
 *
 * Every request the router sends is classed, and a provider receives it only if the
 * provider is approved for that class. The ceilings below come from each provider's
 * published data-use terms for the plan we are on (fetched 2026-09-29, recorded in
 * docs/DECISIONS.md), not from what the model is good at:
 *
 *   groq        processes API data as a processor under a DPA; no inference retention
 *               by default                                   → identifiable customer data
 *   mistral     free plan: inputs may be used for training unless opted out in the
 *               admin console, which we have not verified    → redacted customer data
 *   google      free tier: "Do not submit sensitive, confidential, or personal
 *               information to the Unpaid Services"          → synthetic only
 *   openrouter  free endpoints may log or train on prompts, per upstream → synthetic only
 *   openai, anthropic  paid APIs, no training on inputs by default → identifiable
 *
 * A workspace's own key is the customer's choice of processor under the customer's
 * own agreement with it, so it may carry anything the customer sends.
 *
 * Raising a ceiling is an edit here with a dated entry in the decision log, the same
 * way a route order changes: backed by the terms, not by convenience.
 */

export const DATA_CLASSES = [
  /** Our own public material: documentation, product copy. */
  "public",
  /** Written by us or generated for testing: suite scenarios, personas. */
  "synthetic",
  /** From a customer, with detectable personal data replaced by placeholders. */
  "redacted_customer",
  /** A real person's words or details: support messages, unredacted agent output. */
  "identifiable_customer",
  /** GDPR Art. 9 data. Never auto-detected; declared by the caller. */
  "special_category",
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

/** Bump when a ceiling or the classification rule changes. */
export const DATA_POLICY_VERSION = 1;

const rank = (c: DataClass) => DATA_CLASSES.indexOf(c);
export const higher = (a: DataClass, b: DataClass): DataClass => (rank(a) >= rank(b) ? a : b);
export const allows = (ceiling: DataClass, data: DataClass) => rank(data) <= rank(ceiling);

export const CONNECTION_CEILINGS: Readonly<Record<string, DataClass>> = {
  groq: "identifiable_customer",
  mistral: "redacted_customer",
  google: "synthetic",
  openrouter: "synthetic",
  openai: "identifiable_customer",
  anthropic: "identifiable_customer",
};

/** The most sensitive class a connection may receive. An unknown one of ours: public only. */
export function ceilingFor(connection: { name: string; owner?: "novera" | "customer" }): DataClass {
  if (connection.owner === "customer") return "special_category";
  return CONNECTION_CEILINGS[connection.name] ?? "public";
}

export interface Classified<T> {
  /** The class of the request as the caller wrote it. */
  original: DataClass;
  /** The same request with detectable personal data replaced, and its class — or null
   *  when redaction cannot lower the class (nothing detected, or the caller declared the
   *  content identifiable in itself, as a support message is). */
  redacted: { request: T; dataClass: DataClass } | null;
}

/**
 * Classes a request's text. The caller declares a floor — what the content is by
 * origin — and detection can only raise it: a pattern that looks like an email address
 * makes the request identifiable whatever the caller said. Redaction lowers a class
 * raised by detection, never one the caller declared.
 */
export function classify<T>(args: {
  floor: DataClass;
  texts: string[];
  /** Rebuilds the request from its texts, in the same order, after redaction. */
  rebuild: (texts: string[]) => T;
}): Classified<T> {
  const results = args.texts.map((t) => redact(t));
  const detected = results.some((r) => Object.keys(r.counts).length > 0);
  const original = detected ? higher(args.floor, "identifiable_customer") : args.floor;

  const lowerable = detected && rank(args.floor) < rank("identifiable_customer");
  return {
    original,
    redacted: lowerable
      ? { request: args.rebuild(results.map((r) => r.text)), dataClass: higher(args.floor, "redacted_customer") }
      : null,
  };
}

export function describeClass(c: DataClass): string {
  return c.replace(/_/g, " ");
}
