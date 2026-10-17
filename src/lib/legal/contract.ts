/**
 * What a customer accepts before a paid plan starts, and the proof of it (legal build brief §2,
 * §3, §20.1–20.2, 2026-10-13; every text is a DRAFT for counsel).
 *
 * - The documents accepted, each fingerprinted: SHA-256 over slug, version and body, so an
 *   acceptance names exactly the text that was on the page.
 * - The "unusual" clauses (Romanian Civil Code art. 1203: limitation of liability, suspension
 *   and termination, tacit renewal, governing law, jurisdiction) accepted separately and
 *   expressly, fingerprinted on their own: the text of those sections of the Terms.
 * - The business gate: legal name, registered address, country, an optional VAT number recorded
 *   as declared (never "validated": no validation exists), the signer's name and title, and two
 *   declarations, each its own checkbox since 2026-10-16 (the founder's memo asks for both
 *   separately): acquisition exclusively for trade or business purposes, and authority to bind.
 *
 * Pure apart from hashing, so it is tested without a database.
 */
import { createHash } from "node:crypto";
import type { LegalDocument } from "../../../data/legal/types.ts";
import { legalDocument } from "../../../data/legal/index.ts";
import { missingEntityFields } from "../../../data/legal/entity.ts";
import { countryName } from "./countries.ts";

/** Accepted at checkout, in this order. */
export const CONTRACT_SLUGS = ["terms", "privacy", "dpa", "acceptable-use", "refunds", "ai-testing-scope"] as const;

/**
 * Bumped when the receipt's shape or the form that produced it changes. 1: one checkbox covered
 * business purpose and authority together. 2 (2026-10-16): each is its own checkbox.
 */
export const ACCEPTANCE_RECEIPT_VERSION = 2;

/**
 * The sections of the Terms accepted separately and expressly. Each `heading` must be a heading
 * of the Terms word for word (tests/legal.test.ts); renaming one is a new version of the Terms.
 */
export const UNUSUAL_CLAUSES: ReadonlyArray<{ section: string; heading: string; covers: string }> = [
  { section: "2", heading: "2. Business customers only", covers: "business-only use, and Novera's right to refuse, suspend or terminate" },
  { section: "8", heading: "8. Evidence, not certification", covers: "the limits of every Novera report" },
  { section: "10", heading: "10. Subscription term, renewal and cancellation", covers: "automatic renewal, and no refunds for unused time" },
  { section: "12", heading: "12. Suspension and termination", covers: "suspension and termination rights" },
  { section: "14", heading: "14. Limitation of liability", covers: "the limitation of liability and the exclusion of indirect and regulatory losses" },
  { section: "15", heading: "15. Indemnities", covers: "your indemnities, including for regulatory fines" },
  { section: "17", heading: "17. Governing law and jurisdiction", covers: "Romanian law and the exclusive jurisdiction of the Bucharest courts" },
];

export interface DocumentFingerprint {
  slug: string;
  title: string;
  version: string;
  sha256: string;
  status: "draft" | "approved";
}

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function documentDigest(doc: Pick<LegalDocument, "slug" | "version" | "body">): string {
  return sha256(`${doc.slug}\n${doc.version}\n${doc.body}`);
}

/** The text of one `## ` section of a body, heading included, up to the next `## `. */
export function sectionText(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start, end < 0 ? undefined : end).join("\n").trim();
}

export function unusualClausesText(terms: Pick<LegalDocument, "body">): string {
  return UNUSUAL_CLAUSES.map((c) => {
    const text = sectionText(terms.body, c.heading);
    if (text === null) throw new Error(`The Terms have no section "${c.heading}".`);
    return text;
  }).join("\n\n");
}

export interface ContractSet {
  documents: DocumentFingerprint[];
  terms: { version: string; sha256: string };
  unusual: { version: string; sha256: string };
  /** One fingerprint for the whole set: the page sends it back, so a change while reading is caught. */
  setSha256: string;
  allApproved: boolean;
}

export function contractSet(lookup: (slug: string) => LegalDocument | null = legalDocument): ContractSet {
  const docs = CONTRACT_SLUGS.map((slug) => {
    const doc = lookup(slug);
    if (!doc) throw new Error(`Missing legal document: ${slug}`);
    return doc;
  });
  const documents = docs.map((d) => ({ slug: d.slug, title: d.title, version: d.version, sha256: documentDigest(d), status: d.status }));
  const terms = docs[0];
  const unusual = { version: terms.version, sha256: sha256(unusualClausesText(terms)) };
  return {
    documents,
    terms: { version: terms.version, sha256: documents[0].sha256 },
    unusual,
    setSha256: sha256(JSON.stringify([documents.map((d) => [d.slug, d.version, d.sha256]), unusual.sha256])),
    allApproved: documents.every((d) => d.status === "approved"),
  };
}

/**
 * Why live selling is not allowed yet, in words: every contract document still a draft, and
 * every company detail still missing. Empty means the legal side of the live checklist is met.
 */
export function livePublicationProblems(set: ContractSet = contractSet(), missing: string[] = missingEntityFields()): string[] {
  const problems: string[] = [];
  const drafts = set.documents.filter((d) => d.status !== "approved").map((d) => d.title);
  if (drafts.length) problems.push(`These documents are drafts awaiting counsel: ${drafts.join(", ")}.`);
  if (missing.length) problems.push(`The company details are incomplete (${missing.join(", ")}).`);
  return problems;
}

// ------------------------------------------------------------------ the business gate

export interface AcceptanceInput {
  legalName: string;
  registeredAddress: string;
  country: string;
  vatId: string | null;
  signerName: string;
  signerTitle: string;
}

export type AcceptanceField = keyof AcceptanceInput | "accept_terms" | "accept_unusual" | "accept_business" | "accept_authority" | "set";

const text = (v: FormDataEntryValue | null | undefined) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Reads the business form. Every refusal names the field and says what to do. The four
 * declarations must each be ticked: none is ever pre-ticked, and none implies another.
 */
export function readAcceptanceForm(form: { get(name: string): FormDataEntryValue | null }, expectedSet: string):
  | { ok: true; value: AcceptanceInput }
  | { ok: false; field: AcceptanceField; error: string } {
  if (text(form.get("set")) !== expectedSet) {
    return { ok: false, field: "set", error: "The documents changed while this page was open. Read the current versions, then accept again." };
  }
  const legalName = text(form.get("legalName"));
  if (legalName.length < 2 || legalName.length > 200) return { ok: false, field: "legalName", error: "Enter the organisation's registered legal name, as it should appear on invoices." };
  const registeredAddress = text(form.get("registeredAddress"));
  if (registeredAddress.length < 5 || registeredAddress.length > 500) return { ok: false, field: "registeredAddress", error: "Enter the organisation's registered address." };
  const country = text(form.get("country")).toUpperCase();
  if (!countryName(country)) return { ok: false, field: "country", error: "Enter the two-letter code of the country where the organisation is established, for example RO." };
  const rawVat = text(form.get("vatId")).toUpperCase().replace(/[\s.-]/g, "");
  if (rawVat && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(rawVat)) {
    return { ok: false, field: "vatId", error: "A VAT number starts with its two-letter country prefix, for example RO followed by digits. Leave it empty if the organisation has none." };
  }
  const signerName = text(form.get("signerName"));
  if (signerName.length < 2 || signerName.length > 120) return { ok: false, field: "signerName", error: "Enter your full name." };
  const signerTitle = text(form.get("signerTitle"));
  if (signerTitle.length < 2 || signerTitle.length > 120) return { ok: false, field: "signerTitle", error: "Enter your role in the organisation, for example Director." };
  if (form.get("accept_terms") !== "on") return { ok: false, field: "accept_terms", error: "Tick that you have read and accept the Terms, Privacy Notice, Data Processing Agreement and Acceptable Use Policy." };
  if (form.get("accept_unusual") !== "on") return { ok: false, field: "accept_unusual", error: "The clauses listed must be accepted separately and expressly before a plan can start." };
  if (form.get("accept_business") !== "on") return { ok: false, field: "accept_business", error: "Novera is offered to businesses only. Confirm that the organisation is acquiring it exclusively for its trade, business, craft or profession." };
  if (form.get("accept_authority") !== "on") return { ok: false, field: "accept_authority", error: "Confirm that you have authority to bind the organisation. If you do not, ask someone who does to accept." };
  return { ok: true, value: { legalName, registeredAddress, country, vatId: rawVat || null, signerName, signerTitle } };
}

/** Whether a stored acceptance covers the documents as they are now. */
export function acceptanceIsCurrent(row: { terms_sha256: string; unusual_terms_sha256: string; documents: unknown }, set: ContractSet): boolean {
  if (row.terms_sha256 !== set.terms.sha256 || row.unusual_terms_sha256 !== set.unusual.sha256) return false;
  const accepted = new Map(((row.documents as DocumentFingerprint[] | null) ?? []).map((d) => [d.slug, d.sha256]));
  return set.documents.every((d) => accepted.get(d.slug) === d.sha256);
}
