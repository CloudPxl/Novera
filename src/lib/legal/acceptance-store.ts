import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCEPTANCE_RECEIPT_VERSION, type AcceptanceInput, type ContractSet } from "./contract.ts";

/** A stored acceptance, as the billing page, checkout and the receipt read it. */
export interface AcceptanceRow {
  id: string;
  workspace_id: string;
  user_id: string;
  source_surface: string;
  livemode: boolean;
  legal_entity_name_at_acceptance: string;
  registered_address: string;
  country: string;
  vat_id_declared: string | null;
  vat_id_verified: boolean;
  signer_name_at_acceptance: string;
  signer_title_at_acceptance: string;
  signer_authority_declared: boolean;
  b2b_purpose_declared: boolean;
  unusual_terms_expressly_accepted: boolean;
  terms_version: string;
  terms_sha256: string;
  privacy_version: string;
  dpa_version: string;
  unusual_terms_version: string;
  unusual_terms_sha256: string;
  billing_terms_version: string;
  documents: Array<{ slug: string; title: string; version: string; sha256: string; status: string }>;
  documents_status: string;
  plan_key: string | null;
  user_agent: string | null;
  consent_receipt_version: number;
  accepted_at: string;
}

const COLUMNS = "id, workspace_id, user_id, source_surface, livemode, legal_entity_name_at_acceptance, registered_address, country, vat_id_declared, vat_id_verified, signer_name_at_acceptance, signer_title_at_acceptance, signer_authority_declared, b2b_purpose_declared, unusual_terms_expressly_accepted, terms_version, terms_sha256, privacy_version, dpa_version, unusual_terms_version, unusual_terms_sha256, billing_terms_version, documents, documents_status, plan_key, user_agent, consent_receipt_version, accepted_at";

/** The newest acceptance this workspace made in this deployment's Stripe mode. */
export async function latestAcceptance(db: SupabaseClient, workspaceId: string, livemode: boolean): Promise<AcceptanceRow | null> {
  const { data, error } = await db.from("contract_acceptances").select(COLUMNS)
    .eq("workspace_id", workspaceId).eq("livemode", livemode)
    .order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the contract acceptance: ${error.message}`);
  return (data as AcceptanceRow | null) ?? null;
}

export async function acceptanceById(db: SupabaseClient, workspaceId: string, id: string): Promise<AcceptanceRow | null> {
  const { data, error } = await db.from("contract_acceptances").select(COLUMNS).eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the contract acceptance: ${error.message}`);
  return (data as AcceptanceRow | null) ?? null;
}

const version = (set: ContractSet, slug: string) => set.documents.find((d) => d.slug === slug)?.version ?? "unknown";

export async function recordAcceptance(db: SupabaseClient, args: {
  workspaceId: string;
  userId: string;
  livemode: boolean;
  input: AcceptanceInput;
  set: ContractSet;
  userAgent: string | null;
  locale: string | null;
}): Promise<AcceptanceRow> {
  const { input, set } = args;
  const { data, error } = await db.from("contract_acceptances").insert({
    workspace_id: args.workspaceId,
    user_id: args.userId,
    source_surface: "checkout",
    livemode: args.livemode,
    legal_entity_name_at_acceptance: input.legalName,
    registered_address: input.registeredAddress,
    country: input.country,
    vat_id_declared: input.vatId,
    signer_name_at_acceptance: input.signerName,
    signer_title_at_acceptance: input.signerTitle,
    // Each from its own checkbox (readAcceptanceForm refuses the form unless both are ticked).
    signer_authority_declared: true,
    b2b_purpose_declared: true,
    terms_accepted: true,
    unusual_terms_expressly_accepted: true,
    terms_version: set.terms.version,
    terms_sha256: set.terms.sha256,
    privacy_version: version(set, "privacy"),
    dpa_version: version(set, "dpa"),
    unusual_terms_version: set.unusual.version,
    unusual_terms_sha256: set.unusual.sha256,
    billing_terms_version: version(set, "refunds"),
    documents: set.documents,
    documents_status: set.allApproved ? "approved" : "draft",
    user_agent: args.userAgent ? args.userAgent.slice(0, 300) : null,
    locale: args.locale ? args.locale.slice(0, 35) : null,
    consent_receipt_version: ACCEPTANCE_RECEIPT_VERSION,
  }).select(COLUMNS).single();
  if (error || !data) throw new Error(`Could not record the acceptance: ${error?.message ?? "no row"}`);
  return data as AcceptanceRow;
}

/** The receipt a person downloads: every fact recorded, plain text, no secret. */
export function acceptanceReceipt(row: AcceptanceRow, workspaceName: string): string {
  const lines = [
    "Novera — record of contract acceptance",
    `Receipt format ${row.consent_receipt_version}. Generated from the stored record; the record itself cannot be edited.`,
    "",
    `Accepted at (UTC): ${row.accepted_at}`,
    `Record id: ${row.id}`,
    `Workspace: ${workspaceName} (${row.workspace_id})`,
    `Accepted by user id: ${row.user_id}`,
    `Signer: ${row.signer_name_at_acceptance}, ${row.signer_title_at_acceptance}`,
    `Organisation: ${row.legal_entity_name_at_acceptance}`,
    `Registered address: ${row.registered_address}`,
    `Country: ${row.country}`,
    `VAT number: ${row.vat_id_declared ? `${row.vat_id_declared} (as declared; not validated by Novera)` : "none declared"}`,
    `Mode: ${row.livemode ? "live" : "Stripe sandbox"}`,
    "",
    "Declarations:",
    `- Acquired exclusively for the organisation's trade, business, craft or profession: ${row.b2b_purpose_declared ? "yes" : "no"}`,
    `- Authority to bind the organisation: ${row.signer_authority_declared ? "yes" : "no"}`,
    ...(row.consent_receipt_version < 2 ? ["  (Recorded with receipt format 1, where one checkbox covered both declarations.)"] : []),
    `- Separate, express acceptance of the clauses in Terms sections 2, 8, 10, 12, 14, 15 and 17 (Civil Code art. 1203): ${row.unusual_terms_expressly_accepted ? "yes" : "no"}`,
    `  Fingerprint of those sections (SHA-256): ${row.unusual_terms_sha256}`,
    "",
    `Documents accepted (${row.documents_status === "approved" ? "approved versions" : "DRAFT versions — not yet reviewed by counsel"}):`,
    ...row.documents.map((d) => `- ${d.title}, version ${d.version}, SHA-256 ${d.sha256}`),
  ];
  return lines.join("\n") + "\n";
}
