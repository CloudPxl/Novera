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
 *
 * Version 0.3 (2026-10-16) follows the founder's memo of that date as the draft position: an SRL,
 * the imprint fields it lists, and ANPC and ANSPDCP as the authorities to name. The SRL is not
 * incorporated, so every company fact still reads "pending incorporation". The page stays a
 * noindex draft that no public page links to (tests/legal-framework.test.ts).
 */
import type { LegalDocument } from "./types.ts";
import { LEGAL_ENTITY, type LegalEntity } from "./entity.ts";

const ROWS: Array<[string, keyof LegalEntity, string]> = [
  ["Legal entity name", "legalName", "[LEGAL ENTITY NAME — PENDING INCORPORATION]"],
  ["Legal form", "legalForm", "[LEGAL FORM — PENDING INCORPORATION; DRAFT POSITION: SRL]"],
  ["Registered office", "registeredOffice", "[REGISTERED ADDRESS — PENDING INCORPORATION]"],
  ["Trade register office", "tradeRegister", "[TRADE REGISTER OFFICE — PENDING INCORPORATION]"],
  ["Trade register number", "tradeRegisterNumber", "[TRADE REGISTER NUMBER — PENDING INCORPORATION]"],
  ["Unique registration code (CUI, tax identification)", "uniqueRegistrationCode", "[TAX REGISTRATION CODE — PENDING INCORPORATION]"],
  ["VAT identification number", "vatStatus", "[VAT ID, OR A STATEMENT THAT THE ENTITY IS NOT VAT-REGISTERED — PENDING INCORPORATION]"],
  ["Share capital (required for an SRL)", "shareCapital", "[SHARE CAPITAL — PENDING INCORPORATION]"],
  ["Represented by", "representative", "[RESPONSIBLE REPRESENTATIVE — PENDING INCORPORATION]"],
  ["Contact email", "contactEmail", "[CONTACT EMAIL — PENDING]"],
  ["Telephone", "telephone", "[TELEPHONE, IF REQUIRED]"],
  ["Support hours", "supportHours", "[SUPPORT HOURS]"],
  ["Authorisation and authorising authority (Law 365/2002 art. 5(1)(f))", "competentAuthority", "[AUTHORISING AUTHORITY, OR A STATEMENT THAT NO AUTHORISATION APPLIES — COUNSEL TO CONFIRM]"],
  ["Data protection contact", "privacyContact", "[PRIVACY CONTACT EMAIL — PENDING]"],
];

export function imprintTable(entity: LegalEntity = LEGAL_ENTITY): string {
  const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");
  return ["| Field | Value |", "| --- | --- |", ...ROWS.map(([label, key, placeholder]) => `| ${label} | ${cell(entity[key]?.trim() || placeholder)} |`)].join("\n");
}

export const imprint: LegalDocument = {
  slug: "imprint",
  title: "Imprint",
  summary: "Who operates Novera and how to reach them. The company is not incorporated yet, so every company detail is a placeholder.",
  status: "draft",
  version: "0.3 draft",
  lastReviewed: "2026-10-16",
  sources: ["ro-365-2002", "ro-31-1990", "anspdcp", "anpc"],
  body: `Every field shown in brackets is a placeholder. None of them is a real fact yet.

${imprintTable()}

The company that will operate Novera has not been incorporated yet. Every company detail above is pending its registration with the Trade Register.

The same details are required on invoices, offers, order forms and price lists (Law 31/1990 Article 74). Stripe issues Novera's invoices and receipts, so the Stripe account's public business details must match this page before live billing.

## Supervisory authorities

- Data protection: Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), dataprotection.ro.
- Consumer protection, where it applies: Autoritatea Națională pentru Protecția Consumatorilor (ANPC), anpc.ro. Novera is offered to businesses only.

[DRAFT POSITION FROM THE FOUNDER'S MEMO OF 2026-10-16. COUNSEL TO CONFIRM WHETHER ARTICLE 5(1)(F) REQUIRES ANY AUTHORITY TO BE NAMED FOR AN ACTIVITY THAT NEEDS NO AUTHORISATION, WHICH OF THESE FIELDS ARE REQUIRED FOR THE CHOSEN LEGAL FORM, AND WHETHER ANY COUNTRY NOVERA TARGETS REQUIRES MORE.]`,
};
