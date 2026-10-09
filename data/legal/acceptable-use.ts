/**
 * Acceptable Use and Authorised Testing Policy — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): none prescribes this policy's content; it records
 * the product's own rules (CLAUDE.md non-negotiable rules; the attestation in
 * supabase/migrations/0001 and 0057; agents.is_production checked in the runner;
 * src/lib/net/public-url.ts). GDPR is listed for the test-data rule only.
 * Whether unauthorised testing breaches criminal law in a given country is for counsel.
 */
import type { LegalDocument } from "./types.ts";

export const acceptableUse: LegalDocument = {
  slug: "acceptable-use",
  title: "Acceptable Use and Authorised Testing Policy",
  summary: "Which agents may be tested, with what data, and what Novera may not be used for.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["gdpr"],
  body: `This policy forms part of the Terms of Service. It is a draft for review by counsel.

## Test only what you are authorised to test

- Connect and test only an agent you own, or one whose owner has authorised you to test it in the way Novera tests it, including with adversarial scenarios such as prompt injection and jailbreak attempts.
- Before each run, a member declares that authorisation. Novera stores the declaration, who made it and when, with the run, and every report rests on it. Do not make that declaration unless it is true.
- Check that the agent's hosting and model providers allow automated testing of it, and that a run's volume will not breach their limits.
- A read-back credential should give read-only access to the records a scenario needs, and nothing more.

## Use test data

- Write scenarios with fictional people, accounts and details.
- Do not put real customers' personal data, special category data or credentials into scenarios, policies, Suite Builder sources or production failures unless you have a lawful basis to do so. Novera redacts some patterns automatically, but does not detect names or street addresses.
- Mark an agent that serves real customers as production. Novera will not send it a scenario marked destructive or fixture-only.

## Do not use Novera to

- test, probe or attack a system you are not authorised to test;
- send scenarios designed to cause real-world harm, a real transaction, or a real action against a third party;
- try to reach private, internal or cloud-metadata addresses through agent, read-back or webhook settings (Novera refuses them);
- get around the trial limit, rate limits or workspace boundaries, or access another customer's data;
- reverse-engineer, overload or disrupt Novera or its providers;
- present a Novera report as a certification, a legal opinion or proof of compliance, or alter a sealed report and present it as genuine;
- break the law or a model provider's usage policy.

## What happens if this policy is broken

[COUNSEL TO DRAFT: INVESTIGATION, SUSPENSION, TERMINATION AND REPORTING. NOTE THAT EVIDENCE IS APPEND-ONLY AND IS NOT DELETED ON SUSPENSION.]

## Reporting misuse

Report suspected misuse, including testing of an agent without authorisation, to [ABUSE CONTACT EMAIL].`,
};
