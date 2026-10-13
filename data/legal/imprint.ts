/**
 * Imprint (company information) — DRAFT for legal review.
 *
 * Sources consulted: Romanian Law 365/2002 Article 5(1)(a)–(f) and 5(2) (name, seat, contact
 * details, register number, tax registration code and competent authority, displayed clearly,
 * visibly and permanently; read 2026-10-09); Law 31/1990 Article 74 (legal form and, for an
 * SRL, share capital, on commercial documents and on the website; read 2026-10-13). Other
 * countries' rules differ and are a question for counsel.
 *
 * Rendered from ./entity.ts: a field David has not supplied is a placeholder, never a guess.
 */
import type { LegalDocument } from "./types.ts";
import { LEGAL_ENTITY, type LegalEntity } from "./entity.ts";

const ROWS: Array<[string, keyof LegalEntity, string]> = [
  ["Legal entity name", "legalName", "[LEGAL ENTITY NAME]"],
  ["Legal form", "legalForm", "[LEGAL FORM]"],
  ["Registered office", "registeredOffice", "[REGISTERED ADDRESS]"],
  ["Trade register office", "tradeRegister", "[TRADE REGISTER OFFICE]"],
  ["Trade register number", "tradeRegisterNumber", "[TRADE REGISTER NUMBER]"],
  ["Unique registration code (tax identification)", "uniqueRegistrationCode", "[TAX REGISTRATION CODE]"],
  ["VAT identification number", "vatStatus", "[VAT ID, OR A STATEMENT THAT THE ENTITY IS NOT VAT-REGISTERED]"],
  ["Share capital (required for an SRL)", "shareCapital", "[SHARE CAPITAL]"],
  ["Represented by", "representative", "[RESPONSIBLE REPRESENTATIVE]"],
  ["Contact email", "contactEmail", "[CONTACT EMAIL]"],
  ["Telephone", "telephone", "[TELEPHONE, IF REQUIRED]"],
  ["Support hours", "supportHours", "[SUPPORT HOURS]"],
  ["Supervisory or licensing authority", "competentAuthority", "[COMPETENT AUTHORITY, OR A STATEMENT THAT NONE APPLIES — COUNSEL TO CONFIRM]"],
  ["Data protection contact", "privacyContact", "[PRIVACY CONTACT EMAIL]"],
];

export function imprintTable(entity: LegalEntity = LEGAL_ENTITY): string {
  const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");
  return ["| Field | Value |", "| --- | --- |", ...ROWS.map(([label, key, placeholder]) => `| ${label} | ${cell(entity[key]?.trim() || placeholder)} |`)].join("\n");
}

export const imprint: LegalDocument = {
  slug: "imprint",
  title: "Imprint",
  summary: "Who operates Novera and how to reach them. Every field David has not supplied is a placeholder.",
  status: "draft",
  version: "0.2 draft",
  lastReviewed: "2026-10-13",
  sources: ["ro-365-2002", "ro-31-1990"],
  body: `Every field shown in brackets is a placeholder. None of them is a real fact yet.

${imprintTable()}

The same details are required on invoices, offers, order forms and price lists (Law 31/1990 Article 74). Stripe issues Novera's invoices and receipts, so the Stripe account's public business details must match this page before live billing.

[COUNSEL TO CONFIRM WHICH OF THESE FIELDS ARE REQUIRED FOR THE CHOSEN LEGAL FORM, AND WHETHER ANY COUNTRY NOVERA TARGETS REQUIRES MORE.]`,
};
