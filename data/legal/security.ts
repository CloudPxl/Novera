/**
 * Security and data flow overview — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): GDPR Article 32 is named for counsel only; this
 * page makes no claim of meeting it. Every statement was read from the code:
 * src/lib/crypto.ts (AES-256-GCM), supabase/migrations 0016, 0019, 0034, 0045, 0054
 * (append-only, RLS, tenancy), src/lib/report (SHA-256 seal, chaining, withdrawal),
 * src/proxy.ts (nonce CSP, frame-ancestors), next.config.ts (API headers),
 * src/lib/net/public-url.ts and read-body.ts (public-address guard, size caps),
 * src/lib/api (HMAC keys), docs/LAUNCH-READINESS.md (what is not yet in place).
 */
import type { LegalDocument } from "./types.ts";

export const security: LegalDocument = {
  slug: "security",
  title: "Security and data flow",
  summary: "What the code does to protect data, how data moves through Novera, and what is not yet in place.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["gdpr"],
  body: `This page describes what Novera's code does. It is not a certification, an audit result or a promise that no incident can happen. Novera holds no security certification.

## How data moves

1. A member connects an agent: its address, settings and any authentication header are saved. The header is encrypted before it is stored.
2. A run sends each scenario's messages from Novera's servers in Frankfurt to the agent's address, and records the reply.
3. Deterministic rules check the reply first. If the agent has a read-back, Novera makes a read-only request to the customer's system to confirm a claimed action, and records only whether it matched.
4. What is left goes to language models for grading: on Novera's keys to Groq and Mistral AI, on the workspace's own key to that provider. Keys, agent credentials and read-back responses are never sent to a model.
5. Verdicts and evidence are stored in the database in Frankfurt. A report is built from the stored rows, sealed with a SHA-256 hash, and shared by an unguessable link.
6. Optional webhooks tell the customer's systems that a run finished, with counts and links only.

## What protects it

- **Credentials.** Model API keys and agent authentication headers are encrypted with AES-256-GCM, bound to their workspace, decrypted only on the server, and never sent to a browser, written to a log or put in a report. Novera's API keys are stored only as an HMAC.
- **Separation between customers.** Row-level security in the database decides what each signed-in person can read. Every reference between records is checked in the database to stay within one workspace, even for Novera's own service role.
- **Evidence that cannot be quietly changed.** Verdicts and evidence are append-only, enforced by database triggers; they leave only through workspace erasure or the retention pass. A run's inputs are fixed before it executes.
- **Sealed reports.** Each report carries a SHA-256 hash of its contents and the hash of the previous report for the same agent. A withdrawn report's link stops working at once.
- **Pages.** A nonce-based Content Security Policy, no framing by other sites, and strict headers on the API.
- **Outbound requests.** Novera calls only public addresses. An agent, read-back or webhook address that resolves to a private, loopback or cloud-metadata address is refused when saved and on every call; redirects are not followed; every answer read is size-capped and time-limited.
- **Access within a workspace.** Five roles, checked on every action; an append-only audit trail of who changed access, keys, webhooks, retention and withdrawals.
- **Data minimisation.** Raw agent replies are emptied after the workspace's retention period; personal-data-shaped text is redacted from Suite Builder sources, production failures and sealed reports.

## Not yet in place

Said plainly, because a security page that lists only strengths is not useful:

- no written incident response procedure;
- no tested backup restore, and the database provider's backup terms are not yet documented;
- no error monitoring;
- no continuous integration on every change;
- no independent security assessment or penetration test.

[FOUNDER TO UPDATE THIS LIST BEFORE PUBLICATION.]

## Reporting a vulnerability

Report a security issue to [SECURITY CONTACT EMAIL]. [DISCLOSURE POLICY — DECISION REQUIRED.]`,
};
