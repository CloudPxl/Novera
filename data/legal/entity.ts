/**
 * The legal entity that sells Novera, as the imprint, the Terms, invoices and Checkout state
 * it (Law 365/2002 art. 5; Law 31/1990 art. 74). Every field is null until David supplies it:
 * nothing here is guessed, and a null field renders as a visible placeholder.
 *
 * `entityComplete()` gates live selling (src/lib/legal/publication.ts): a live checkout is
 * refused while any required field is missing.
 *
 * The founder's memo of 2026-10-16 (docs/legal/2026-10-16-founder-memo.md) proposes an SRL and
 * lists the imprint fields as legal name, form, registered office, trade register number (Jxx/...),
 * CUI, share capital and contact email. The SRL is not incorporated yet, so every value stays null:
 * the memo is a draft position, and none of these facts exists until the registration does.
 */
export interface LegalEntity {
  legalName: string | null;
  legalForm: string | null;
  registeredOffice: string | null;
  tradeRegister: string | null;
  tradeRegisterNumber: string | null;
  uniqueRegistrationCode: string | null;
  /** The VAT number, or the statement that the entity is not VAT-registered. */
  vatStatus: string | null;
  /** Required for an SRL (Law 31/1990 art. 74; also in the founder's memo's imprint list). */
  shareCapital: string | null;
  representative: string | null;
  contactEmail: string | null;
  telephone: string | null;
  supportHours: string | null;
  /**
   * Law 365/2002 art. 5(1)(f): the authority that authorised the activity, where it needs an
   * authorisation; otherwise counsel confirms none applies. The founder's memo names ANPC (consumer
   * protection, where applicable) and ANSPDCP (data protection). Those are supervisory authorities,
   * not an authorisation, so the imprint lists them in a separate paragraph as a draft position and
   * this field waits on counsel (docs/LEGAL-COUNSEL-QUESTIONS.md question 4).
   */
  competentAuthority: string | null;
  /** A designated privacy contact (the memo: no mandatory DPO). No mailbox exists for one yet. */
  privacyContact: string | null;
}

export const LEGAL_ENTITY: LegalEntity = {
  legalName: null,
  legalForm: null,
  registeredOffice: null,
  tradeRegister: null,
  tradeRegisterNumber: null,
  uniqueRegistrationCode: null,
  vatStatus: null,
  shareCapital: null,
  representative: null,
  contactEmail: null,
  telephone: null,
  supportHours: null,
  competentAuthority: null,
  privacyContact: null,
};

/**
 * The fields a live sale needs: the imprint list of the founder's memo (2026-10-16) plus the VAT
 * status. Share capital is required because the memo proposes an SRL (Law 31/1990 art. 74); if the
 * accountant chooses another form, counsel confirms whether it stays. Telephone, support hours and
 * authority wait on counsel.
 */
export const REQUIRED_ENTITY_FIELDS: Array<keyof LegalEntity> = [
  "legalName", "legalForm", "registeredOffice", "tradeRegisterNumber", "uniqueRegistrationCode", "vatStatus", "shareCapital", "contactEmail",
];

export function missingEntityFields(entity: LegalEntity = LEGAL_ENTITY): Array<keyof LegalEntity> {
  return REQUIRED_ENTITY_FIELDS.filter((k) => !entity[k]?.trim());
}

export function entityComplete(entity: LegalEntity = LEGAL_ENTITY): boolean {
  return missingEntityFields(entity).length === 0;
}
