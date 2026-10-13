/**
 * The legal entity that sells Novera, as the imprint, the Terms, invoices and Checkout state
 * it (Law 365/2002 art. 5; Law 31/1990 art. 74). Every field is null until David supplies it:
 * nothing here is guessed, and a null field renders as a visible placeholder.
 *
 * `entityComplete()` gates live selling (src/lib/legal/publication.ts): a live checkout is
 * refused while any required field is missing.
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
  /** Required for an SRL (Law 31/1990 art. 74). */
  shareCapital: string | null;
  representative: string | null;
  contactEmail: string | null;
  telephone: string | null;
  supportHours: string | null;
  /** Only where the activity needs an authorisation; otherwise counsel confirms none applies. */
  competentAuthority: string | null;
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

/** The fields a live sale needs. Telephone, support hours and authority wait on counsel. */
export const REQUIRED_ENTITY_FIELDS: Array<keyof LegalEntity> = [
  "legalName", "legalForm", "registeredOffice", "tradeRegisterNumber", "uniqueRegistrationCode", "vatStatus", "contactEmail",
];

export function missingEntityFields(entity: LegalEntity = LEGAL_ENTITY): Array<keyof LegalEntity> {
  return REQUIRED_ENTITY_FIELDS.filter((k) => !entity[k]?.trim());
}

export function entityComplete(entity: LegalEntity = LEGAL_ENTITY): boolean {
  return missingEntityFields(entity).length === 0;
}
