/**
 * The launch gates of the legal build brief (§23): what a controlled B2B pilot needs, and what a
 * paid B2B launch adds. Each gate is one of three kinds, and the page says which:
 *
 *   - `code`: computed now from the code and this deployment's configuration (the entity record,
 *     the publication rule, billingConfig).
 *   - `built`: a property of the code itself, enforced where `source` says. True of every
 *     deployment of this commit; a regression is caught by the tests named there.
 *   - `stated`: not verifiable from code (a dashboard, a mailbox, a ruleset, a lawyer). Its state
 *     is read at request time from the row of docs/LAUNCH-READINESS.md it names, and is "ready"
 *     only when that row says exactly PASS. The page labels it "not verifiable from code".
 *
 * Nothing here is assumed: a gate with neither a computation nor a ledger row waits on its owner.
 */
import { LEGAL_DOCUMENTS, legalDocument } from "../../../data/legal/index.ts";
import type { LegalDocument } from "../../../data/legal/types.ts";
import { LEGAL_ENTITY, missingEntityFields, type LegalEntity } from "../../../data/legal/entity.ts";
import { publicationProblems } from "../legal/publication.ts";
import { contractSet, livePublicationProblems } from "../legal/contract.ts";
import { REPORT_NOTICE_TITLE } from "../legal/notices.ts";
import { billingConfig } from "../billing/config.ts";
import { PLAN_CATALOG, PLAN_KEYS } from "../billing/plans.ts";
import { mailDiagnostics } from "../mail/diagnostics.ts";
import type { LedgerRow } from "./repo-docs.ts";
import type { ReadinessState } from "./status.ts";

type Env = Record<string, string | undefined>;

export type LaunchStage = "pilot" | "paid";
export type GateBasis = "code" | "built" | "stated";
export type GateOwner = "David" | "Counsel" | "Accountant" | "Code";

export interface Gate {
  id: string;
  stage: LaunchStage;
  title: string;
  state: ReadinessState;
  basis: GateBasis;
  owner: GateOwner;
  /** What was found, in one or two sentences. */
  detail: string;
  /** Where it is enforced, or the ledger rows it was read from. */
  source: string[];
}

export interface GateContext {
  env: Env;
  entity: LegalEntity;
  documents: readonly LegalDocument[];
  /** docs/LAUNCH-READINESS.md parsed, or null when the file could not be read here. */
  ledger: Map<string, LedgerRow> | null;
}

const OWNER_STATE: Record<Exclude<GateOwner, "Code">, ReadinessState> = { David: "david", Counsel: "counsel", Accountant: "accountant" };

/** A gate nothing in the code can check: its state is what the named ledger rows say. */
function stated(ctx: GateContext, g: { id: string; stage: LaunchStage; title: string; owner: Exclude<GateOwner, "Code">; rows: string[] }): Gate {
  const waiting = OWNER_STATE[g.owner];
  if (!ctx.ledger) {
    return { ...g, basis: "stated", state: waiting, detail: "docs/LAUNCH-READINESS.md could not be read on this deployment, so no recorded status is shown.", source: g.rows.map((r) => `docs/LAUNCH-READINESS.md ${r}`) };
  }
  const found = g.rows.map((id) => ({ id, row: ctx.ledger!.get(id) ?? null }));
  const allPass = found.every((f) => f.row?.status === "PASS");
  return {
    ...g,
    basis: "stated",
    state: allPass ? "ready" : waiting,
    detail: found.map((f) => f.row ? `${f.id} “${f.row.item}”: ${f.row.status}` : `${f.id}: no such row`).join(" · "),
    source: g.rows.map((r) => `docs/LAUNCH-READINESS.md ${r}`),
  };
}

function published(ctx: GateContext, g: { id: string; stage: LaunchStage; title: string }, slug: string): Gate {
  const doc = ctx.documents.find((d) => d.slug === slug) ?? legalDocument(slug);
  const problems = doc ? publicationProblems(doc, missingEntityFields(ctx.entity).length === 0) : ["no such document"];
  const counselNeeded = problems.some((p) => p !== "company details incomplete");
  return {
    ...g,
    basis: "code",
    owner: counselNeeded ? "Counsel" : problems.length ? "David" : "Code",
    state: problems.length === 0 ? "ready" : counselNeeded ? "counsel" : "david",
    detail: problems.length ? `${doc?.title ?? slug}: ${problems.join("; ")}.` : `${doc!.title} is approved, archived and published.`,
    source: ["src/lib/legal/publication.ts", `data/legal/${slug}.ts`],
  };
}

export function buildGates(input: Partial<GateContext> = {}): Gate[] {
  const ctx: GateContext = {
    env: input.env ?? process.env,
    entity: input.entity ?? LEGAL_ENTITY,
    documents: input.documents ?? LEGAL_DOCUMENTS,
    ledger: input.ledger === undefined ? null : input.ledger,
  };
  const missing = missingEntityFields(ctx.entity);
  const config = billingConfig(ctx.env);
  const mail = mailDiagnostics(ctx.env);
  const approved = ctx.documents.filter((d) => d.status === "approved").length;
  const legalBlockers = livePublicationProblems(contractSet((slug) => ctx.documents.find((d) => d.slug === slug) ?? null), missing);
  const draftPlans = PLAN_KEYS.filter((k) => PLAN_CATALOG[k].status === "draft").map((k) => PLAN_CATALOG[k].name);
  const liveHere = config.active && config.mode === "live";

  const emailGate = stated(ctx, { id: "email", stage: "pilot", title: "Email confirmation and password reset tested in production", owner: "David", rows: ["A1"] });
  if (!mail.configured) {
    emailGate.state = "david";
    emailGate.detail = `This server cannot send email (Resend settings incomplete). ${emailGate.detail}`;
  }

  return [
    // ------------------------------------------------------------------ controlled B2B pilot
    emailGate,
    stated(ctx, { id: "oauth", stage: "pilot", title: "Google and GitHub sign-in link test", owner: "David", rows: ["D"] }),
    stated(ctx, { id: "branch", stage: "pilot", title: "main branch protection", owner: "David", rows: ["O5"] }),
    {
      id: "entity", stage: "pilot", title: "Legal entity disclosed", basis: "code",
      owner: missing.length ? "David" : "Code", state: missing.length ? "david" : "ready",
      detail: missing.length ? `${missing.length} required company detail${missing.length === 1 ? " is" : "s are"} empty in data/legal/entity.ts.` : "Every required company detail is filled.",
      source: ["data/legal/entity.ts"],
    },
    stated(ctx, { id: "drafts", stage: "pilot", title: "Legal drafts provisionally reviewed by counsel", owner: "Counsel", rows: ["L1"] }),
    published(ctx, { id: "privacy", stage: "pilot", title: "Privacy notice visible before personal data is collected" }, "privacy"),
    published(ctx, { id: "terms", stage: "pilot", title: "Terms visible" }, "terms"),
    {
      id: "ai-limitation", stage: "pilot", title: "AI testing limitation on every report and export", basis: "built", owner: "Code", state: "ready",
      detail: `“${REPORT_NOTICE_TITLE}” on every report's cover, in every export and beside the report link, outside the sealed payload.`,
      source: ["src/lib/legal/notices.ts", "tests/ci.test.ts", "tests/report-export.test.ts"],
    },
    stated(ctx, { id: "mailbox", stage: "pilot", title: "Support mailbox receives mail", owner: "David", rows: ["O13"] }),
    stated(ctx, { id: "uptime", stage: "pilot", title: "Uptime monitor", owner: "David", rows: ["O10"] }),
    stated(ctx, { id: "backups", stage: "pilot", title: "Backup posture", owner: "David", rows: ["O11"] }),
    {
      id: "attestation", stage: "pilot", title: "Authorisation attestation retained with each run", basis: "built", owner: "Code", state: "ready",
      detail: "Every run copies its agent's attestation when it starts, and the attestation cannot be rewritten after the agent is connected.",
      source: ["startRun (src/lib/workflow/start-run.ts)", "0057 agents_attestation_frozen"],
    },
    {
      id: "no-certification", stage: "pilot", title: "No certification or compliance claims", basis: "built", owner: "Code", state: "ready",
      detail: "The report language rule and the legal tests refuse certified, compliant and approved-by-a-regulator wording about an agent or report.",
      source: ["src/lib/report/language.ts", "tests/language.test.ts", "tests/legal.test.ts"],
    },

    // ------------------------------------------------------------------ paid B2B launch adds
    {
      id: "vat", stage: "paid", title: "Accountant's VAT review", basis: "code",
      owner: "Accountant", state: config.automaticTax ? "ready" : "accountant",
      detail: config.automaticTax ? "Stripe Tax is on here." : "Stripe Tax is off here and stays off until question 42 is answered.",
      source: ["billingConfig (src/lib/billing/config.ts)", "docs/LEGAL-COUNSEL-QUESTIONS.md 42"],
    },
    {
      id: "lawyer", stage: "paid", title: "Lawyer's review of every legal document", basis: "code",
      owner: approved === ctx.documents.length ? "Code" : "Counsel", state: approved === ctx.documents.length ? "ready" : "counsel",
      detail: `${approved} of ${ctx.documents.length} documents approved.`,
      source: ["data/legal/index.ts", "data/legal/archive.ts"],
    },
    {
      id: "live-legal", stage: "paid", title: "Live checkout passes the legal checks", basis: "code",
      owner: legalBlockers.length ? (legalBlockers.some((p) => p.includes("drafts")) ? "Counsel" : "David") : "Code",
      state: legalBlockers.length ? (legalBlockers.some((p) => p.includes("drafts")) ? "counsel" : "david") : "ready",
      detail: legalBlockers.length ? legalBlockers.join(" ") : "No contract document is a draft and the company details are complete.",
      source: ["livePublicationProblems (src/lib/legal/contract.ts)"],
    },
    stated(ctx, { id: "sandbox", stage: "paid", title: "Stripe sandbox tested end to end", owner: "David", rows: ["P3"] }),
    {
      id: "live-prices", stage: "paid", title: "Live prices", basis: "code",
      owner: draftPlans.length || !liveHere ? "David" : "Code", state: draftPlans.length || !liveHere ? "david" : "ready",
      detail: `${draftPlans.length ? `Draft in the catalog, which no live checkout sells: ${draftPlans.join(", ")}. ` : ""}Billing here is ${config.active ? `in ${config.mode} mode` : "off"}. Prices are not published until the legal entity exists.`,
      source: ["PLAN_CATALOG (src/lib/billing/plans.ts)", "docs/BILLING-DECISIONS.md §7"],
    },
    {
      id: "live-webhook", stage: "paid", title: "Live webhook and customer portal", basis: liveHere ? "stated" : "code",
      owner: "David", state: "david",
      detail: liveHere
        ? "Billing is live here. Whether the live webhook destination and portal are configured is in Stripe's dashboard, not verifiable from code."
        : `Billing is ${config.active ? `in ${config.mode} mode` : "off"} here; live mode has its own webhook destination and portal.`,
      source: ["billingConfig (src/lib/billing/config.ts)", "docs/BILLING-DECISIONS.md §7 item 4"],
    },
    stated(ctx, { id: "vercel", stage: "paid", title: "Vercel commercial tier", owner: "David", rows: ["O12"] }),
    {
      id: "entitlement", stage: "paid", title: "Final entitlement decision", basis: "built", owner: "Code", state: "ready",
      detail: "D3, decided 2026-10-12: after the trial every run needs a plan or a grant, own key or not. startRun and 0067 enforce it.",
      source: ["docs/BILLING-DECISIONS.md D3", "workspaceEntitlement (src/lib/auth/entitlement.ts)", "0067"],
    },
    published(ctx, { id: "refunds", stage: "paid", title: "Refund policy published" }, "refunds"),
    published(ctx, { id: "imprint", stage: "paid", title: "Imprint published" }, "imprint"),
    published(ctx, { id: "subprocessors", stage: "paid", title: "Sub-processor list published" }, "subprocessors"),
    stated(ctx, { id: "ownership", stage: "paid", title: "Alerting and backup ownership", owner: "David", rows: ["O10", "O11"] }),
  ];
}
