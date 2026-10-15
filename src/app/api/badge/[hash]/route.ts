import { lookupSeal } from "@/app/verify/lookup.ts";
import { badgeResponse } from "@/lib/report/badge.ts";

/**
 * `GET /api/badge/<sha256>` (or `<sha256>.svg`): the embeddable badge for one sealed report.
 *
 * Public and unauthenticated, like the seal check at `/verify/<sha256>` it links to, and it
 * makes that check's one read (`lookupSeal`): the four receipt columns of the report stored
 * under the digest, never its token, workspace, run or withdrawer. What it draws, and every
 * header, is in `src/lib/report/badge.ts`.
 */

// Per request: the answer is the stored row now. The CDN keeps it for the window
// `badgeHeaders` names, so a withdrawal reaches every cached copy within that window.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  return badgeResponse(hash, lookupSeal);
}
