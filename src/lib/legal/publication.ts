/**
 * When a legal document may be presented as final (legal build brief §20.5). A document is
 * published only when counsel approved it (status, approval record, frozen archive entry) and
 * the company details are complete; until then it stays noindex, carries the draft banner, and
 * live billing refuses to ask anyone to accept it (src/lib/legal/contract.ts).
 */
import type { LegalDocument } from "../../../data/legal/types.ts";
import { APPROVED_VERSIONS } from "../../../data/legal/archive.ts";
import { entityComplete } from "../../../data/legal/entity.ts";
import { documentDigest } from "./contract.ts";

/** Why a document is not publishable, or an empty list. */
export function publicationProblems(doc: LegalDocument, complete: boolean = entityComplete()): string[] {
  const problems: string[] = [];
  if (doc.status !== "approved") problems.push("draft awaiting counsel");
  if (doc.status === "approved" && !doc.approval) problems.push("approved without an approval record");
  const archived = APPROVED_VERSIONS.find((a) => a.slug === doc.slug && a.version === doc.version);
  if (doc.status === "approved" && (!archived || archived.sha256 !== documentDigest(doc))) problems.push("approved text is not the archived version");
  if (!complete) problems.push("company details incomplete");
  return problems;
}

export function isPublished(doc: LegalDocument): boolean {
  return publicationProblems(doc).length === 0;
}
