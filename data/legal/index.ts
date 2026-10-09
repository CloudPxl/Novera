/**
 * The public legal documents, in the order the index lists them. Every one is a draft
 * for counsel; none is in force. See docs/legal-inputs-required.md for what each still
 * needs and docs/LEGAL-COUNSEL-QUESTIONS.md for what to ask.
 */
import type { LegalDocument } from "./types.ts";
import { privacy } from "./privacy.ts";
import { terms } from "./terms.ts";
import { dpa } from "./dpa.ts";
import { subprocessors } from "./subprocessors.ts";
import { cookies } from "./cookies.ts";
import { acceptableUse } from "./acceptable-use.ts";
import { security } from "./security.ts";
import { aiTestingScope } from "./ai-testing-scope.ts";
import { refunds } from "./refunds.ts";
import { imprint } from "./imprint.ts";

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  privacy,
  terms,
  dpa,
  subprocessors,
  cookies,
  acceptableUse,
  security,
  aiTestingScope,
  refunds,
  imprint,
];

export function legalDocument(slug: string): LegalDocument | null {
  return LEGAL_DOCUMENTS.find((d) => d.slug === slug) ?? null;
}

/** The status line every page carries while it is a draft. */
export const DRAFT_BANNER = "Draft — requires legal review and completion of company details";
