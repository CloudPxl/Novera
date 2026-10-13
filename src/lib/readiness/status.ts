/**
 * The live half of the staff readiness page (/readiness, "Status"): what this deployment's code
 * and configuration say about launching, computed on every request. Every check is derived from a
 * function the product itself uses — the entity record, the publication rules, billingConfig, the
 * mail diagnostics, the provider register — so the page cannot say something the code would not do.
 *
 * Configuration is reported as presence and mode only. No environment value, key or part of one is
 * ever in the result (tests/launch-readiness.test.ts serialises it and looks).
 */
import { LEGAL_DOCUMENTS } from "../../../data/legal/index.ts";
import type { LegalDocument } from "../../../data/legal/types.ts";
import { LEGAL_ENTITY, REQUIRED_ENTITY_FIELDS, missingEntityFields, type LegalEntity } from "../../../data/legal/entity.ts";
import { PROVIDER_REGISTER, activeHere } from "../../../data/legal/register.ts";
import { publicationProblems } from "../legal/publication.ts";
import { contractSet, livePublicationProblems } from "../legal/contract.ts";
import { billingConfig, keyMode, PRICE_ENV } from "../billing/config.ts";
import { PLAN_KEYS, PLAN_CATALOG } from "../billing/plans.ts";
import { mailDiagnostics } from "../mail/diagnostics.ts";

type Env = Record<string, string | undefined>;

export type ReadinessState = "ready" | "david" | "counsel" | "accountant" | "blocked";

export const STATE_LABEL: Record<ReadinessState, string> = {
  ready: "Ready",
  david: "Waiting on David",
  counsel: "Waiting on counsel",
  accountant: "Waiting on accountant",
  blocked: "Blocked",
};

export interface CheckItem {
  label: string;
  value: string;
  state?: ReadinessState;
}

export interface StatusCheck {
  id: string;
  title: string;
  state: ReadinessState;
  /** One sentence: what the code found. */
  summary: string;
  /** Per-thing breakdown (a document, a provider), when the check covers several. */
  items?: CheckItem[];
  /** Where the rule this check reads is enforced. */
  enforcedAt: string[];
}

export interface StatusInput {
  env?: Env;
  entity?: LegalEntity;
  documents?: readonly LegalDocument[];
}

export type DeploymentEnvironment = ReturnType<typeof mailDiagnostics>["environment"];

/** Production, preview, development or local: the same reading the email diagnostics make. */
export function deploymentEnvironment(env: Env = process.env): DeploymentEnvironment {
  return mailDiagnostics(env).environment;
}

const ENTITY_LABEL: Record<keyof LegalEntity, string> = {
  legalName: "legal name",
  legalForm: "legal form",
  registeredOffice: "registered office",
  tradeRegister: "trade register",
  tradeRegisterNumber: "trade register number",
  uniqueRegistrationCode: "unique registration code (CUI)",
  vatStatus: "VAT status",
  shareCapital: "share capital",
  representative: "representative",
  contactEmail: "contact email",
  telephone: "telephone",
  supportHours: "support hours",
  competentAuthority: "competent authority",
  privacyContact: "privacy contact",
};

export function entityCheck(entity: LegalEntity = LEGAL_ENTITY): StatusCheck {
  const missing = missingEntityFields(entity);
  const optional = (Object.keys(entity) as Array<keyof LegalEntity>)
    .filter((k) => !REQUIRED_ENTITY_FIELDS.includes(k) && !entity[k]?.trim());
  const filled = REQUIRED_ENTITY_FIELDS.length - missing.length;
  return {
    id: "entity",
    title: "Company details",
    state: missing.length ? "david" : "ready",
    summary: missing.length
      ? `${filled} of ${REQUIRED_ENTITY_FIELDS.length} required fields filled. Live checkout and live acceptance are refused until every one is.`
      : `All ${REQUIRED_ENTITY_FIELDS.length} required fields are filled.`,
    items: [
      ...(missing.length ? [{ label: "Missing, required for a live sale", value: missing.map((k) => ENTITY_LABEL[k]).join(", "), state: "david" as const }] : []),
      ...(optional.length ? [{ label: "Not filled, which counsel confirms per legal form", value: optional.map((k) => ENTITY_LABEL[k]).join(", ") }] : []),
    ],
    enforcedAt: ["data/legal/entity.ts", "livePublicationProblems (src/lib/legal/contract.ts)"],
  };
}

/** Each document's publication state, from the same rule the /legal pages use. */
export function documentsCheck(documents: readonly LegalDocument[] = LEGAL_DOCUMENTS, entity: LegalEntity = LEGAL_ENTITY): StatusCheck {
  const complete = missingEntityFields(entity).length === 0;
  const items: CheckItem[] = documents.map((doc) => {
    const problems = publicationProblems(doc, complete);
    const state: ReadinessState = problems.length === 0 ? "ready"
      : problems.some((p) => p !== "company details incomplete") ? "counsel" : "david";
    return {
      label: `${doc.title} (version ${doc.version})`,
      value: problems.length ? problems.join("; ") : "approved and published",
      state,
    };
  });
  const published = items.filter((i) => i.state === "ready").length;
  const state: ReadinessState = items.some((i) => i.state === "counsel") ? "counsel" : items.some((i) => i.state === "david") ? "david" : "ready";
  return {
    id: "documents",
    title: "Legal documents",
    state,
    summary: `${published} of ${documents.length} published. A document is published only when approved, recorded, archived word for word, and the company details are complete.`,
    items,
    enforcedAt: ["src/lib/legal/publication.ts", "data/legal/archive.ts", "data/legal/index.ts"],
  };
}

/** Billing on this deployment: its mode, why it is off, and what live selling still needs. */
export function billingCheck(env: Env = process.env, documents: readonly LegalDocument[] = LEGAL_DOCUMENTS, entity: LegalEntity = LEGAL_ENTITY): StatusCheck {
  const config = billingConfig(env);
  const where = deploymentEnvironment(env);
  const secret = env.STRIPE_SECRET_KEY?.trim();
  const testKeyOnProduction = Boolean(secret) && keyMode(secret!) === "test" && env.VERCEL_ENV === "production";
  const liveKeyUnapproved = Boolean(secret) && keyMode(secret!) === "live" && !config.active;
  const legal = livePublicationProblems(
    contractSet((slug) => documents.find((d) => d.slug === slug) ?? null),
    missingEntityFields(entity),
  );
  const mode = config.active ? config.mode! : "off";
  const draftPlans = PLAN_KEYS.filter((k) => PLAN_CATALOG[k].status === "draft");

  let state: ReadinessState;
  if (testKeyOnProduction) state = "blocked";
  else if (legal.some((p) => p.includes("drafts awaiting counsel"))) state = "counsel";
  else if (legal.length || liveKeyUnapproved || mode !== "live") state = "david";
  else state = "ready";

  const items: CheckItem[] = [
    { label: "This deployment", value: where },
    { label: "Billing mode here", value: mode, state: testKeyOnProduction ? "blocked" : undefined },
    ...(config.reason ? [{ label: "Why billing is off here", value: config.reason }] : []),
    { label: "Stripe secret key", value: secret ? `present (${keyMode(secret) ?? "not a secret key"})` : "absent" },
    { label: "Webhook signing secret", value: env.STRIPE_WEBHOOK_SECRET?.trim() ? "present" : "absent" },
    ...PLAN_KEYS.map((k) => ({ label: `${PLAN_CATALOG[k].name} price (${PRICE_ENV[k]})`, value: config.prices[k] ? "present" : "absent" })),
    { label: "Plans in the catalog still draft", value: draftPlans.length ? draftPlans.map((k) => PLAN_CATALOG[k].name).join(", ") : "none" },
    ...legal.map((p) => ({ label: "Live selling refused", value: p, state: (p.includes("drafts") ? "counsel" : "david") as ReadinessState })),
  ];
  return {
    id: "billing",
    title: "Live billing",
    state,
    summary: testKeyOnProduction
      ? "A Stripe test key is configured on production. Billing refuses it, so nothing can be bought here until it is removed."
      : `Billing is ${mode === "off" ? "off" : `in ${mode} mode`} on this ${where} deployment. ${legal.length ? `${legal.length} legal blocker${legal.length === 1 ? "" : "s"} refuse a live sale.` : "No legal blocker refuses a live sale."}`,
    items,
    enforcedAt: ["billingConfig (src/lib/billing/config.ts)", "livePublicationProblems (src/lib/legal/contract.ts)", "startCheckout (src/lib/billing/actions.ts)"],
  };
}

export function emailCheck(env: Env = process.env): StatusCheck {
  const d = mailDiagnostics(env);
  return {
    id: "email",
    title: "Email",
    state: d.configured ? "ready" : "david",
    summary: d.configured
      ? "This server has what it needs to send through Resend. Delivery is proven only by a message arriving."
      : "This server cannot send email: the Resend settings are incomplete.",
    items: [
      { label: "RESEND_API_KEY", value: d.resendKey.present ? "present" : "absent", state: d.resendKey.present ? undefined : "david" },
      { label: "RESEND_FROM_EMAIL", value: d.from.present ? "present" : "absent", state: d.from.present ? undefined : "david" },
      ...d.problems.map((p) => ({ label: "To fix", value: p, state: "david" as const })),
      ...d.unreadable.map((u) => ({ label: "Not readable from this server", value: u })),
    ],
    enforcedAt: ["src/lib/mail/diagnostics.ts", "/inbox/email"],
  };
}

/** Whether each provider in the register is in use here, by the same function /legal/subprocessors.json uses. */
export function providersCheck(env: Env = process.env): StatusCheck {
  const items: CheckItem[] = PROVIDER_REGISTER.map((p) => ({
    label: `${p.provider} (${p.status})`,
    value: activeHere(p, env) ? "in use on this deployment" : "not in use on this deployment",
    state: p.status === "core" && !activeHere(p, env) ? "david" as const : undefined,
  }));
  const coreIdle = PROVIDER_REGISTER.filter((p) => p.status === "core" && !activeHere(p, env)).map((p) => p.provider);
  const unverified = PROVIDER_REGISTER.filter((p) => p.status !== "planned" && (/\[/.test(p.legalEntity) || /\[/.test(p.transfer))).length;
  return {
    id: "providers",
    title: "Providers",
    state: coreIdle.length ? "david" : unverified ? "counsel" : "ready",
    summary: `${coreIdle.length ? `Core provider${coreIdle.length === 1 ? "" : "s"} not in use here: ${coreIdle.join(", ")}. ` : "Every core provider is in use here. "}`
      + `${unverified} provider${unverified === 1 ? " has" : "s have"} a contracting entity or transfer mechanism still to verify.`,
    items,
    enforcedAt: ["activeHere (data/legal/register.ts)", "/legal/subprocessors.json"],
  };
}

export function vatCheck(env: Env = process.env): StatusCheck {
  const config = billingConfig(env);
  return {
    id: "vat",
    title: "VAT and Stripe Tax",
    state: config.automaticTax ? "ready" : "accountant",
    summary: config.automaticTax
      ? "Stripe Tax is on for Checkout here (BILLING_AUTOMATIC_TAX)."
      : "Stripe Tax is off. It stays off until the accountant answers question 42 (reverse charge, invoice wording, VIES, net or gross prices).",
    items: [
      { label: "Stripe Tax on Checkout (BILLING_AUTOMATIC_TAX)", value: config.automaticTax ? "on" : "off" },
      { label: "Business tax ID on Checkout (BILLING_TAX_ID_COLLECTION)", value: config.taxIdCollection ? "on" : "off" },
    ],
    enforcedAt: ["billingConfig (src/lib/billing/config.ts)", "docs/LEGAL-COUNSEL-QUESTIONS.md question 42"],
  };
}

/** Every Status-tab check, in the order the page shows them. */
export function buildStatus(input: StatusInput = {}): StatusCheck[] {
  const env = input.env ?? process.env;
  const entity = input.entity ?? LEGAL_ENTITY;
  const documents = input.documents ?? LEGAL_DOCUMENTS;
  return [
    entityCheck(entity),
    documentsCheck(documents, entity),
    billingCheck(env, documents, entity),
    emailCheck(env),
    providersCheck(env),
    vatCheck(env),
  ];
}

export function countStates(checks: ReadonlyArray<{ state: ReadinessState }>): Record<ReadinessState, number> {
  const counts: Record<ReadinessState, number> = { ready: 0, david: 0, counsel: 0, accountant: 0, blocked: 0 };
  for (const c of checks) counts[c.state]++;
  return counts;
}
