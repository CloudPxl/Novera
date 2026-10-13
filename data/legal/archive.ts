/**
 * Every legal document version that counsel approved, frozen (legal build brief §20.5). An
 * approved document's current text must match its entry here word for word; editing it without
 * a new version and a new entry fails tests/legal.test.ts. Entries are only ever added: a
 * customer who accepted version 1.0 must be able to read version 1.0 for as long as the contract
 * matters.
 *
 * Empty: nothing has been approved yet.
 */
export interface ArchivedVersion {
  slug: string;
  version: string;
  /** documentDigest() of the approved text (src/lib/legal/contract.ts). */
  sha256: string;
  approvedBy: string;
  approvedAt: string;
  effectiveDate: string;
  body: string;
}

export const APPROVED_VERSIONS: readonly ArchivedVersion[] = [];
