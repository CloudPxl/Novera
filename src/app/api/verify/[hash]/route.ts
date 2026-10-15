import { verifyAnswer } from "@/lib/report/verify-answer.ts";
import { lookupSeal } from "@/app/verify/lookup.ts";

// Per request: the answer is the ledger's, read once by digest. Caching is the header's job.
export const dynamic = "force-dynamic";

/** The public seal receipt as JSON. Status codes and caching: `src/lib/report/verify-answer.ts`. */
export async function GET(_request: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  return verifyAnswer(hash, lookupSeal);
}
