/**
 * How independent the models behind a verdict actually were.
 *
 * Consensus was built on the assumption that two verdicts are worth more than one.
 * That is only true when the two models can fail differently. Until 2026-09-22 the
 * route could — and on a busy day routinely did — serve both votes from
 * `groq/openai/gpt-oss-120b` and `groq/openai/gpt-oss-20b`: same vendor, same model
 * family, same serving stack, same rate limit. Two such votes agreeing is close to
 * one vote counted twice, and the report was presenting it as corroboration.
 *
 * Nothing here is new evidence. `judge_votes` has stored `connection/model` per vote
 * since migration 0008, so independence is *derived* from rows that already exist —
 * which means every historical run can be described honestly without a migration and
 * without a report payload change that would break documents already issued.
 */

export type Independence =
  /** Two or more distinct vendors returned a verdict. The strong case. */
  | "independent"
  /** More than one model, but all from one vendor. Corroborated, weakly. */
  | "single-vendor"
  /** One model answered. Not corroborated at all. */
  | "single-model";

interface VoteLike {
  model: string;
  status: "pass" | "fail" | "error";
}

/** The connection half of `connection/model`, which is the vendor. */
export function vendorOf(model: string): string {
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(0, slash);
}

/**
 * Only votes that produced a verdict count. A vendor that errored corroborated
 * nothing, and counting it would make an unreachable provider look like a second
 * opinion — the exact inflation this function exists to prevent.
 */
export function independenceOf(votes: readonly VoteLike[] | null | undefined): Independence {
  const answered = (votes ?? []).filter((v) => v.status !== "error");
  if (answered.length < 2) return "single-model";
  const vendors = new Set(answered.map((v) => vendorOf(v.model)));
  return vendors.size >= 2 ? "independent" : "single-vendor";
}

/** Distinct vendors that returned a verdict, in first-seen order. */
export function vendorsOf(votes: readonly VoteLike[] | null | undefined): string[] {
  const seen: string[] = [];
  for (const v of votes ?? []) {
    if (v.status === "error") continue;
    const vendor = vendorOf(v.model);
    if (!seen.includes(vendor)) seen.push(vendor);
  }
  return seen;
}

export const INDEPENDENCE_LABEL: Record<Independence, string> = {
  independent: "Independently corroborated",
  "single-vendor": "Corroborated within one vendor",
  "single-model": "Not corroborated",
};
