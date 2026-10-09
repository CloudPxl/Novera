/**
 * Imprint (company information) — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): Romanian Law 365/2002 Article 5(1)(a)–(f) and
 * 5(2) (name, seat, contact details, register number, tax registration code and
 * competent authority, displayed clearly, visibly and permanently). Other countries'
 * rules (for example Germany's) differ and are a question for counsel.
 *
 * Every field is a placeholder. No company has been named here because none has been
 * confirmed.
 */
import type { LegalDocument } from "./types.ts";

export const imprint: LegalDocument = {
  slug: "imprint",
  title: "Imprint",
  summary: "Who operates Novera and how to reach them. Every field is still a placeholder.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["ro-365-2002"],
  body: `Every field below is a placeholder. None of them is a real fact yet.

| Field | Value |
| --- | --- |
| Legal entity name | [LEGAL ENTITY NAME] |
| Legal form | [LEGAL FORM] |
| Registered office | [REGISTERED ADDRESS] |
| Trade register and registration number | [TRADE REGISTER NAME AND NUMBER] |
| Unique registration code (tax identification) | [TAX REGISTRATION CODE] |
| VAT identification number | [VAT ID, OR A STATEMENT THAT THE ENTITY IS NOT VAT-REGISTERED] |
| Share capital, if required to be stated | [SHARE CAPITAL] |
| Contact email | [CONTACT EMAIL] |
| Telephone | [TELEPHONE, IF REQUIRED] |
| Person responsible for the content | [RESPONSIBLE REPRESENTATIVE] |
| Supervisory or licensing authority | [COMPETENT AUTHORITY, OR A STATEMENT THAT NONE APPLIES — COUNSEL TO CONFIRM] |
| Data protection contact | [PRIVACY CONTACT EMAIL] |

[COUNSEL TO CONFIRM WHICH OF THESE FIELDS ARE REQUIRED FOR THE CHOSEN LEGAL FORM, AND WHETHER ANY COUNTRY NOVERA TARGETS REQUIRES MORE.]`,
};
