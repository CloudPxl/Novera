/**
 * Sub-processor list — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): GDPR Article 28(2) and (4) (prior authorisation,
 * same obligations passed down, the initial processor stays liable); EDPB Guidelines
 * 07/2020 (general authorisation with a right to object); EDPB Opinion 22/2024 (the
 * controller should have each sub-processor's identity, address and contact to hand).
 *
 * A location is stated only where this repository verifies it: the Supabase region in
 * CLAUDE.md, the Vercel function region in vercel.json. Everything else is a visible
 * placeholder. Providers are taken from src/lib/router/routes.ts, src/lib/providers/
 * registry.ts and src/lib/privacy/data-class.ts (which data each may receive), and
 * src/lib/mail/send.ts (Resend). Stripe and any monitoring vendor are not active and are
 * listed only under "planned".
 */
import type { LegalDocument } from "./types.ts";

export interface Subprocessor {
  provider: string;
  service: string;
  purpose: string;
  data: string;
  location: string;
  transfer: string;
  /** core: always in the path · optional: a fallback or only when configured by Novera. */
  use: "core" | "optional";
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    provider: "Supabase",
    service: "Postgres database, authentication, scheduled jobs",
    purpose: "Stores accounts, workspaces, agents, policies, runs, evidence, reports and every other record; signs people in",
    data: "All categories in the Privacy Notice",
    location: "Project region eu-central-1 (Frankfurt, Germany), per project configuration. Location of backups, logs and support access: [TO VERIFY WITH SUPABASE]",
    transfer: "[TRANSFER MECHANISM, IF ANY — COUNSEL TO CONFIRM]",
    use: "core",
  },
  {
    provider: "Vercel",
    service: "Application hosting, server functions, content delivery network",
    purpose: "Serves the pages and runs the server code",
    data: "All categories in transit; request metadata such as IP address and user agent in platform logs",
    location: "Server functions pinned to region fra1 (Frankfurt, Germany) in vercel.json. Static files and the edge network may serve a request from a location near the visitor, worldwide. Build and log storage location: [TO VERIFY WITH VERCEL]",
    transfer: "[TRANSFER MECHANISM — COUNSEL TO CONFIRM]",
    use: "core",
  },
  {
    provider: "Resend",
    service: "Transactional email",
    purpose: "Sends invitations and approved support replies; sign-in emails once connected to the authentication service",
    data: "Recipient email address, message content",
    location: "[TO VERIFY WITH RESEND]",
    transfer: "[TRANSFER MECHANISM — COUNSEL TO CONFIRM]",
    use: "core",
  },
  {
    provider: "Groq",
    service: "Language model inference (Novera's own key)",
    purpose: "Grades scenarios on the trial allowance; drafts support replies; diagnoses failures; answers Ask Novera; Suite Builder extraction",
    data: "Scenario text, agent replies, workspace summaries for Ask Novera, support message content. May include personal data",
    location: "Operated from the United States, per Novera's documentation. Processing location: [TO VERIFY WITH GROQ]",
    transfer: "[TRANSFER MECHANISM — COUNSEL TO CONFIRM]",
    use: "core",
  },
  {
    provider: "Mistral AI",
    service: "Language model inference (Novera's own key)",
    purpose: "Second, independent grading opinion; fallback for drafting, diagnosis and Ask Novera",
    data: "As for Groq. May include personal data",
    location: "Operated from France, per Novera's documentation. Processing location: [TO VERIFY WITH MISTRAL AI]",
    transfer: "[TRANSFER MECHANISM, IF ANY — COUNSEL TO CONFIRM]",
    use: "core",
  },
  {
    provider: "OpenRouter",
    service: "Language model inference (Novera's own key, free models)",
    purpose: "Fallback for diagnosis",
    data: "Only material Novera wrote itself (documentation, test scenarios). The router refuses to send it customer data",
    location: "[TO VERIFY WITH OPENROUTER]",
    transfer: "[TRANSFER MECHANISM — COUNSEL TO CONFIRM]",
    use: "optional",
  },
  {
    provider: "Google (Gemini API, free tier)",
    service: "Language model inference (Novera's own key), when that key is configured",
    purpose: "Fallback for diagnosis and drafting",
    data: "Only material Novera wrote itself. The router refuses to send it customer data",
    location: "[TO VERIFY WITH GOOGLE]",
    transfer: "[TRANSFER MECHANISM — COUNSEL TO CONFIRM]",
    use: "optional",
  },
];

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");

function table(): string {
  const head = "| Provider | Service | Purpose | Personal data it may receive | Processing location | Transfer mechanism | Use |";
  const rows = SUBPROCESSORS.map((p) =>
    `| ${[p.provider, p.service, p.purpose, p.data, p.location, p.transfer, p.use === "core" ? "Core" : "Optional"].map(cell).join(" | ")} |`,
  );
  return [head, "| --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}

export const subprocessors: LegalDocument = {
  slug: "subprocessors",
  title: "Sub-processors",
  summary: "Every third party that processes data for Novera, what it receives and where — locations only where verified.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["gdpr", "edpb-07-2020", "edpb-opinion-22-2024"],
  body: `This list names the third parties that process personal data when Novera provides its service. It is a draft: the transfer mechanism for each provider, and every location marked as a placeholder, still has to be verified with the provider and confirmed by counsel.

**Last updated:** 9 October 2026. **Effective date:** [EFFECTIVE DATE].

## Active sub-processors

${table()}

A location is stated only where Novera's own configuration shows it. The database region and the region the server functions run in are configuration Novera controls. Where a provider's processing location has not been verified, the field says so. Some providers listed here process data outside the European Economic Area, and Novera does not keep all processing inside the EU.

## Which model provider receives what

Each model provider Novera uses on its own keys is approved for a kind of data, based on the provider's published terms for the plan used. Every request is classified before it is sent, and a provider that is not approved for what a request contains is not sent it. Groq and Mistral AI may receive personal data. OpenRouter and Google's free tier receive only material Novera wrote itself. The approvals were set from each provider's terms as read on 29 September 2026 and are [TO BE RE-VERIFIED BEFORE PUBLICATION].

At the date of this draft, diagnosis, scenario drafting and Suite Builder extraction use Novera's own providers even when a workspace has connected its own model key. Grading and Ask Novera on such a workspace use only the workspace's key.

## Configured by the customer, not engaged by Novera

These are chosen and configured by the customer. Whether any of them is a sub-processor of Novera, or a processor or recipient chosen by the customer, is a question for counsel.

| Service | What it receives | Who chooses it |
| --- | --- | --- |
| The customer's own model provider (Groq, Google AI Studio, OpenRouter or Anthropic) | Everything that workspace's grading and Ask Novera send: scenarios, agent replies, workspace summaries | The customer, under its own agreement with the provider |
| The agent under test | Each scenario's messages, and any conversation history or context the scenario declares | The customer |
| A read-back endpoint | A read-only request to check a claimed action; its response body is not stored | The customer |
| Webhook receivers | Run counts and links; never agent replies, inputs, policy text or keys | The customer |
| Google or GitHub sign-in | The sign-in request, when a person chooses that way in | The person signing in |

## Planned, not active

None of the following processes any data today. Each would be added to the table above, with notice under the change procedure below, before it does.

- Stripe, for billing. Only a sandbox integration is planned; no live payments are taken.
- An error-monitoring service. No vendor has been chosen.
- OpenAI or Anthropic on Novera's own keys, as a third grading vendor. No funded key is configured.

## Changes to this list

[CHANGE NOTICE MECHANISM — COUNSEL TO CONFIRM: for example, notice to workspace owners by email a stated number of days before a new sub-processor processes customer data, with a right to object as described in the Data Processing Agreement.]`,
};
