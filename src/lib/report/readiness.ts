import { contentHash, type Json } from "./hash.ts";
import type { ReportPayload } from "./payload.ts";

/**
 * Whether a sealed report is ready to go to a client, from stored rows only.
 *
 * A report is sealed when a run finishes, whatever the run found, so "there is a link" is
 * not the same as "this is something to hand over". This answers the second question with
 * a state and the checks behind it, and never moves a report up a state because someone
 * wants to share it: an incomplete run stays INCOMPLETE however the link is used.
 *
 *  - READY_TO_SHARE: every planned scenario has a verdict, the hash verifies, the scope
 *    and limitations are stated, no pass rests on one model, and no review is missing from it.
 *  - READY_FOR_INTERNAL_REVIEW: complete and intact, with something a person should see
 *    first — passes one model gave alone, or reviews recorded after it was sealed.
 *  - INCOMPLETE / WITHHELD: as the sealed grade says; rerun, or fix what made it unusable.
 *  - BLOCKED_BY_EVIDENCE: the document itself does not hold together — the hash does not
 *    match, the counts do not cover the plan, or the limitations block is missing.
 *  - REVOKED / EXPIRED: the link no longer opens.
 *
 * Failures do not lower the state. A report that says the agent failed T15 is exactly the
 * evidence a client is owed.
 */
export type Readiness = "READY_TO_SHARE" | "READY_FOR_INTERNAL_REVIEW" | "INCOMPLETE" | "WITHHELD" | "BLOCKED_BY_EVIDENCE" | "REVOKED" | "EXPIRED";

export interface ReadinessCheck {
  label: string;
  /** `ok`, a `gap` that lowers the state, or a `note` that is said and changes nothing. */
  result: "ok" | "gap" | "note";
  detail: string;
}

export interface ReadinessInput {
  report: {
    payload: ReportPayload;
    content_hash: string;
    expires_at: string;
    revoked_at: string | null;
  };
  /** Reviews recorded on this run after the report was sealed. */
  undisclosedReviews: number;
  now?: Date;
}

export function readinessOf(input: ReadinessInput): { state: Readiness; checks: ReadinessCheck[] } {
  const { payload, content_hash, expires_at, revoked_at } = input.report;
  const now = input.now ?? new Date();
  const checks: ReadinessCheck[] = [];
  const c = payload.coverage;
  const band = payload.grade?.band;

  const intact = contentHash(payload as unknown as Json) === content_hash;
  checks.push({ label: "The sealed document is intact", result: intact ? "ok" : "gap",
    detail: intact ? "Its SHA-256 matches the hash printed on it." : "Its content no longer matches the hash printed on it." });

  const scoped = Boolean(payload.run?.manifest_hash);
  checks.push({ label: "Inputs declared before the run", result: scoped ? "ok" : "note",
    detail: scoped ? "Suite version, scenario list, policy version and graders were fixed before anything ran."
      : "This run predates the declared manifest; the report names its suite and policy versions." });

  const authorised = Boolean(payload.subject?.authorisation) && payload.subject.authorisation !== "Not recorded.";
  checks.push({ label: "Authorisation to test recorded", result: authorised ? "ok" : "gap",
    detail: authorised ? payload.subject.authorisation : "No authorisation to test this agent was recorded with the run." });

  const accounted = c.passed + c.failed + c.errored + c.not_run >= c.planned && c.planned > 0;
  checks.push({ label: "Every planned scenario accounted for", result: accounted ? "ok" : "gap",
    detail: accounted ? `${c.planned} planned: ${c.passed} passed, ${c.failed} failed, ${c.errored} with no verdict, ${c.not_run} not run.`
      : "The counts do not cover every planned scenario." });

  const missing = c.errored + c.not_run;
  checks.push({ label: "Scenarios without a verdict disclosed", result: missing === 0 ? "ok" : "note",
    detail: missing === 0 ? "Every scenario has a verdict." : `${missing} without a verdict, each named in the report and never counted as a pass.` });

  const lonePasses = payload.run?.corroboration?.uncorroborated_passes ?? 0;
  const sameVendor = payload.run?.corroboration?.single_vendor ?? 0;
  checks.push({ label: "Verdicts corroborated", result: lonePasses > 0 ? "gap" : sameVendor > 0 ? "note" : "ok",
    detail: lonePasses > 0 ? `${lonePasses} pass(es) rest on one model's verdict. The report says so; a release gate reads them as incomplete. Rerun first.`
      : sameVendor > 0 ? `${sameVendor} verdict(s) were corroborated by two models from one vendor, which the report states.`
      : "Each model-graded verdict was confirmed by a second model, or settled by a rule." });

  const fingerprint = payload.run?.fingerprint;
  checks.push({ label: "What was tested is stated", result: "note",
    detail: fingerprint ? `Each item is labelled recorded by Novera, declared by you, or not supplied (${fingerprint.filter((f) => f.provenance === "declared").length} declared).`
      : "This report predates the environment fingerprint; it names the agent and suite only." });

  const limits = typeof payload.limitations === "string" && payload.limitations.trim().length > 0;
  checks.push({ label: "Scope and limitations stated", result: limits ? "ok" : "gap",
    detail: limits ? "The report says it is evidence of testing, not a legal certification." : "The limitations block is missing." });

  checks.push({ label: "No conversations or keys in the document", result: "ok",
    detail: "By construction: a report carries findings and counts, never the agent's replies, the policy text or a key." });

  checks.push({ label: "Reviews disclosed", result: input.undisclosedReviews > 0 ? "gap" : "ok",
    detail: input.undisclosedReviews > 0 ? `${input.undisclosedReviews} review(s) recorded after this report was sealed. Issue an updated report so the client sees them.`
      : "Nothing recorded since sealing that the report does not carry." });

  const expired = new Date(expires_at) < now;
  checks.push({ label: "Link open", result: revoked_at || expired ? "gap" : "ok",
    detail: revoked_at ? `Withdrawn ${revoked_at.slice(0, 10)}.` : expired ? `Expired ${expires_at.slice(0, 10)}.` : `Opens until ${expires_at.slice(0, 10)}; you can withdraw it at any time.` });

  const state: Readiness = revoked_at ? "REVOKED"
    : expired ? "EXPIRED"
    : !intact || !accounted || !limits ? "BLOCKED_BY_EVIDENCE"
    : band === "INCOMPLETE" ? "INCOMPLETE"
    : band === "WITHHELD" ? "WITHHELD"
    : lonePasses > 0 || input.undisclosedReviews > 0 || !authorised ? "READY_FOR_INTERNAL_REVIEW"
    : "READY_TO_SHARE";
  return { state, checks };
}

export const READINESS_LABEL: Record<Readiness, string> = {
  READY_TO_SHARE: "Ready to share",
  READY_FOR_INTERNAL_REVIEW: "Review before sharing",
  INCOMPLETE: "Incomplete: rerun before sharing",
  WITHHELD: "Grade withheld: fix the evidence first",
  BLOCKED_BY_EVIDENCE: "Blocked: the document does not hold together",
  REVOKED: "Withdrawn",
  EXPIRED: "Expired",
};
