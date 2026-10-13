/**
 * The provider and data-flow register — one list, read by the Sub-processors page, the
 * Privacy Notice's recipients, the DPA's sub-processor annex, the machine-readable copy at
 * /legal/subprocessors.json and the workspace's routing notices (legal build brief §12.1 and
 * §20.6, 2026-10-13). DRAFT — COUNSEL REVIEW REQUIRED.
 *
 * Two rules, each held by tests/legal.test.ts:
 *   - A provider is listed as a sub-processor because Novera engages it, not because the code
 *     can talk to it. Planned providers are listed apart and process nothing.
 *   - Whether a provider is in use *on a given deployment* is read from that deployment's
 *     configuration (`activeHere`), never assumed: an email provider whose key is empty sends
 *     nothing, and the machine-readable register says so.
 *
 * A location is stated only where this repository verifies it (the Supabase region in
 * CLAUDE.md, the Vercel function region in vercel.json). Contracting entities and transfer
 * mechanisms are placeholders until verified with each provider and confirmed by counsel.
 */

export type ProviderStatus = "core" | "optional" | "planned";
export type ProviderCategory = "database" | "hosting" | "email" | "payments" | "model-inference" | "monitoring";

export interface ProviderEntry {
  provider: string;
  /** The exact contracting entity, once verified. */
  legalEntity: string;
  category: ProviderCategory;
  service: string;
  purpose: string;
  /** Personal data it may receive, in words. */
  data: string;
  /** The data classes of src/lib/privacy/data-class.ts it may be sent, where that applies. */
  dataClasses: string[];
  location: string;
  /** True only where the location above is verified from Novera's own configuration. */
  regionVerified: boolean;
  transfer: string;
  /** Who chose this provider for this processing. */
  configuredBy: "novera";
  status: ProviderStatus;
  /** Environment variables that must all be non-empty for this provider to be in use on a deployment. Empty: always in use. */
  activeWhen: string[];
  lastReviewed: string;
}

const UNVERIFIED_ENTITY = "[CONTRACTING ENTITY — TO VERIFY]";
const TRANSFER = "[TRANSFER MECHANISM — COUNSEL TO CONFIRM]";

export const PROVIDER_REGISTER: readonly ProviderEntry[] = [
  {
    provider: "Supabase",
    legalEntity: UNVERIFIED_ENTITY,
    category: "database",
    service: "Postgres database, authentication, scheduled jobs",
    purpose: "Stores accounts, workspaces, agents, policies, runs, evidence, reports, contract acceptances and every other record; signs people in",
    data: "All categories in the Privacy Notice",
    dataClasses: ["all"],
    location: "Project region eu-central-1 (Frankfurt, Germany), per project configuration. Location of backups, logs and support access: [TO VERIFY WITH SUPABASE]",
    regionVerified: true,
    transfer: "[TRANSFER MECHANISM, IF ANY — COUNSEL TO CONFIRM]",
    configuredBy: "novera",
    status: "core",
    activeWhen: [],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "Vercel",
    legalEntity: UNVERIFIED_ENTITY,
    category: "hosting",
    service: "Application hosting, server functions, content delivery network",
    purpose: "Serves the pages and runs the server code",
    data: "All categories in transit; request metadata such as IP address and user agent in platform logs",
    dataClasses: ["all"],
    location: "Server functions pinned to region fra1 (Frankfurt, Germany) in vercel.json. Static files and the edge network may serve a request from a location near the visitor, worldwide. Build and log storage location: [TO VERIFY WITH VERCEL]",
    regionVerified: true,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "core",
    activeWhen: [],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "Resend",
    legalEntity: UNVERIFIED_ENTITY,
    category: "email",
    service: "Transactional email",
    purpose: "Sends invitations and approved support replies; sign-in emails once connected to the authentication service",
    data: "Recipient email address, message content",
    dataClasses: ["identifiable"],
    location: "[TO VERIFY WITH RESEND]",
    regionVerified: false,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "core",
    activeWhen: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "Groq",
    legalEntity: UNVERIFIED_ENTITY,
    category: "model-inference",
    service: "Language model inference (Novera's own key)",
    purpose: "Grades scenarios on the trial allowance and Agency Pro's managed runs; plays the simulated customer in persona scenarios; drafts scenarios from a policy; drafts support replies; diagnoses failures; answers Ask Novera; Suite Builder extraction",
    data: "Scenario text, agent replies, workspace summaries for Ask Novera, support message content. May include personal data",
    dataClasses: ["public", "synthetic", "redacted", "identifiable"],
    location: "Operated from the United States, per Novera's documentation. Processing location: [TO VERIFY WITH GROQ]",
    regionVerified: false,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "core",
    activeWhen: ["GROQ_API_KEY"],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "Mistral AI",
    legalEntity: UNVERIFIED_ENTITY,
    category: "model-inference",
    service: "Language model inference (Novera's own key)",
    purpose: "Second, independent grading opinion; fallback for the simulated customer, drafting, diagnosis and Ask Novera",
    data: "As for Groq. May include personal data",
    dataClasses: ["public", "synthetic", "redacted", "identifiable"],
    location: "Operated from France, per Novera's documentation. Processing location: [TO VERIFY WITH MISTRAL AI]",
    regionVerified: false,
    transfer: "[TRANSFER MECHANISM, IF ANY — COUNSEL TO CONFIRM]",
    configuredBy: "novera",
    status: "core",
    activeWhen: ["MISTRAL_API_KEY"],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "OpenRouter",
    legalEntity: UNVERIFIED_ENTITY,
    category: "model-inference",
    service: "Language model inference (Novera's own key, free models)",
    purpose: "Novera's internal measurement scripts only. Approved only for material Novera wrote itself, and every product feature sends customer material, so the service sends it nothing",
    data: "Only material Novera wrote itself (documentation, test scenarios). The router refuses to send it customer data",
    dataClasses: ["public", "synthetic"],
    location: "[TO VERIFY WITH OPENROUTER]",
    regionVerified: false,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "optional",
    activeWhen: ["OPENROUTER_API_KEY"],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "Google (Gemini API, free tier)",
    legalEntity: UNVERIFIED_ENTITY,
    category: "model-inference",
    service: "Language model inference (Novera's own key), when that key is configured",
    purpose: "Novera's internal measurement scripts only, as for OpenRouter",
    data: "Only material Novera wrote itself. The router refuses to send it customer data",
    dataClasses: ["public", "synthetic"],
    location: "[TO VERIFY WITH GOOGLE]",
    regionVerified: false,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "optional",
    activeWhen: ["JUDGE_FREE_API_KEY"],
    lastReviewed: "2026-10-13",
  },
  // ---------------------------------------------------------------- planned: process nothing today
  {
    provider: "Stripe",
    legalEntity: UNVERIFIED_ENTITY,
    category: "payments",
    service: "Subscriptions, checkout, invoices, receipts, billing portal",
    purpose: "Takes payment for plans and keeps invoices; the business details a customer gives at checkout are its billing details. Sandbox only until live billing is approved; a production deployment refuses a test key",
    data: "Billing contact email, legal entity name, billing address, VAT number as declared, payment method (held by Stripe, never by Novera)",
    dataClasses: ["identifiable"],
    location: "[TO VERIFY WITH STRIPE]",
    regionVerified: false,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "planned",
    activeWhen: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "Error monitoring (vendor not chosen)",
    legalEntity: UNVERIFIED_ENTITY,
    category: "monitoring",
    service: "Scrubbed server error reports",
    purpose: "Tells Novera a server error happened; reports carry no customer content (src/lib/observability)",
    data: "Error type, route, release; no request bodies, tokens or customer content",
    dataClasses: ["public"],
    location: "[TO VERIFY ONCE CHOSEN]",
    regionVerified: false,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "planned",
    activeWhen: ["NOVERA_ERROR_REPORTING"],
    lastReviewed: "2026-10-13",
  },
  {
    provider: "OpenAI or Anthropic (Novera's own key)",
    legalEntity: UNVERIFIED_ENTITY,
    category: "model-inference",
    service: "A third grading vendor",
    purpose: "Would grade scenarios beside Groq and Mistral AI. No funded key is configured",
    data: "As for Groq, once a data-class decision is made",
    dataClasses: [],
    location: "[TO VERIFY ONCE CONFIGURED]",
    regionVerified: false,
    transfer: TRANSFER,
    configuredBy: "novera",
    status: "planned",
    activeWhen: ["ANTHROPIC_API_KEY"],
    lastReviewed: "2026-10-13",
  },
];

/** Chosen and configured by the customer, not engaged by Novera. Whether each is Novera's sub-processor is a question for counsel. */
export const CUSTOMER_CONFIGURED: ReadonlyArray<{ service: string; receives: string; chosenBy: string }> = [
  { service: "The customer's own model provider (Groq, Google AI Studio, OpenRouter or Anthropic)", receives: "Everything that workspace's grading, diagnosis, drafting, Suite Builder extraction and Ask Novera send: scenarios, agent replies, workspace summaries", chosenBy: "The customer, under its own agreement with the provider" },
  { service: "The agent under test", receives: "Each scenario's messages, and any conversation history or context the scenario declares", chosenBy: "The customer" },
  { service: "A read-back endpoint", receives: "A read-only request to check a claimed action; its response body is not stored", chosenBy: "The customer" },
  { service: "Webhook receivers", receives: "Run counts and links; never agent replies, inputs, policy text or keys", chosenBy: "The customer" },
  { service: "Google or GitHub sign-in", receives: "The sign-in request, when a person chooses that way in", chosenBy: "The person signing in" },
];

export const REGISTER_VERSION = "2026-10-13";

/** Whether each provider is in use on this deployment, from its configuration only. */
export function activeHere(entry: ProviderEntry, env: Record<string, string | undefined> = process.env): boolean {
  return entry.activeWhen.every((name) => Boolean(env[name]?.trim()));
}

/** The machine-readable register: what the entries say, plus whether each is in use here. Never an env value. */
export function registerSnapshot(env: Record<string, string | undefined> = process.env) {
  return {
    register_version: REGISTER_VERSION,
    status: "draft — counsel review required",
    providers: PROVIDER_REGISTER.map((p) => ({
      provider: p.provider,
      legal_entity: p.legalEntity,
      category: p.category,
      service: p.service,
      purpose: p.purpose,
      data: p.data,
      data_classes: p.dataClasses,
      location: p.location,
      region_verified: p.regionVerified,
      transfer: p.transfer,
      configured_by: p.configuredBy,
      status: p.status,
      in_use_on_this_deployment: activeHere(p, env),
      last_reviewed: p.lastReviewed,
    })),
    customer_configured: CUSTOMER_CONFIGURED,
  };
}
