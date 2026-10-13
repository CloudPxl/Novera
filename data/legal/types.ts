/**
 * The shape of a public legal document while it is a draft for counsel.
 *
 * The body is the same small Markdown subset the documentation uses
 * (src/lib/docs/markdown.ts) plus pipe tables, parsed to a structure and rendered as
 * React elements — never as markup. Placeholders are written in square brackets and
 * capitals, such as [LEGAL ENTITY NAME], and the page highlights each one, so a reader
 * cannot mistake a missing fact for a real one.
 */

export type SourceKind =
  /** The text of a law, as published by the official journal or national portal. */
  | "primary"
  /** Guidance from a supervisory authority, the EDPB or the Commission. */
  | "official-guidance"
  /** A regulator's own website, for contact details and procedure. */
  | "authority"
  /** Practitioner commentary. Identifies issues for counsel; never authoritative. */
  | "non-authoritative";

export interface LegalSource {
  id: string;
  title: string;
  url: string;
  kind: SourceKind;
  /** ISO date this source was read for the drafts. */
  fetched: string;
  /** What was read in it, and any caveat about the version read. */
  note: string;
}

export interface LegalDocument {
  slug: string;
  title: string;
  /** One sentence for the index. */
  summary: string;
  /**
   * Every page is a draft until counsel signs it off. "approved" needs an `approval` record,
   * and an approved version is frozen in ./archive.ts (src/lib/legal/publication.ts checks it).
   */
  status: "draft" | "approved";
  /** Who signed this version off and when it takes effect. Present only when approved. */
  approval?: { approvedBy: string; approvedAt: string; effectiveDate: string };
  /** Version label of the draft, not of any legal act. */
  version: string;
  /** ISO date the draft was last checked against the code and the sources. */
  lastReviewed: string;
  /** Ids from ./sources.ts. */
  sources: string[];
  body: string;
}
