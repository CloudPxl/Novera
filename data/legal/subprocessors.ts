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
import { CUSTOMER_CONFIGURED, PROVIDER_REGISTER } from "./register.ts";

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

/** Engaged by Novera today, from the one register (./register.ts). Planned providers are not here. */
export const SUBPROCESSORS: readonly Subprocessor[] = PROVIDER_REGISTER
  .filter((p) => p.status !== "planned")
  .map((p) => ({ provider: p.provider, service: p.service, purpose: p.purpose, data: p.data, location: p.location, transfer: p.transfer, use: p.status as "core" | "optional" }));

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
  version: "0.2 draft",
  lastReviewed: "2026-10-13",
  sources: ["gdpr", "edpb-07-2020", "edpb-opinion-22-2024"],
  body: `This list names the third parties that process personal data when Novera provides its service. It is a draft: the transfer mechanism for each provider, and every location marked as a placeholder, still has to be verified with the provider and confirmed by counsel.

**Last updated:** 13 October 2026. **Effective date:** [EFFECTIVE DATE].

## Active sub-processors

${table()}

A location is stated only where Novera's own configuration shows it. The database region and the region the server functions run in are configuration Novera controls. Where a provider's processing location has not been verified, the field says so. Some providers listed here process data outside the European Economic Area, and Novera does not keep all processing inside the EU.

## Which model provider receives what

Each model provider Novera uses on its own keys is approved for a kind of data, based on the provider's published terms for the plan used. Every request is classified before it is sent, and a provider that is not approved for what a request contains is not sent it. Groq, Mistral AI and Google (the Gemini API on Novera's paid key, from 22 October 2026) may receive personal data; Google's published terms for the paid tier say requests are not used to improve its products [TO BE RE-VERIFIED BEFORE PUBLICATION, with the processing location]. OpenRouter and Google's free tier are approved only for material Novera wrote itself, which no product feature sends; in practice they receive nothing from the service. The approvals were set from each provider's terms as read on 29 September 2026 and are [TO BE RE-VERIFIED BEFORE PUBLICATION].

A workspace that has connected its own model key is served on that key alone for grading, diagnosis, scenario drafting, Suite Builder extraction and Ask Novera, with no fallback to Novera's providers (since 2026-10-09). Novera's providers above serve workspaces without their own key, and Novera's own support-reply drafting.

## Configured by the customer, not engaged by Novera

These are chosen and configured by the customer. Whether any of them is a sub-processor of Novera, or a processor or recipient chosen by the customer, is a question for counsel.

| Service | What it receives | Who chooses it |
| --- | --- | --- |
${CUSTOMER_CONFIGURED.map((c) => `| ${cell(c.service)} | ${cell(c.receives)} | ${cell(c.chosenBy)} |`).join("\n")}

## Planned, not active

None of the following processes any data today. Each would be added to the table above, with notice under the change procedure below, before it does.

${PROVIDER_REGISTER.filter((p) => p.status === "planned").map((p) => `- **${p.provider}** — ${p.purpose}.`).join("\n")}

## Machine-readable copy

The same register, with whether each provider is in use on the deployment that serves it (read from that deployment's configuration), is at /legal/subprocessors.json.

## Changes to this list

[CHANGE NOTICE MECHANISM — COUNSEL TO CONFIRM: for example, notice to workspace owners by email a stated number of days before a new sub-processor processes customer data, with a right to object as described in the Data Processing Agreement.]`,
};
