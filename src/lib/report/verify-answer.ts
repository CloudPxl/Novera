import { normaliseDigest } from "./canonical.ts";
import type { SealReceipt } from "./public-verify.ts";

/**
 * `GET /api/verify/<sha256>`: the public seal receipt as JSON, for the file check on `/verify`
 * (which hashes a report in the reader's browser and sends only the digest) and for anyone
 * scripting the same check.
 *
 * The body is exactly the receipt `/verify/<sha256>` renders (`buildReceipt`, an allow-list):
 * no token, client, agent, workspace, run or policy identifier, nothing from the findings.
 *
 * Status codes, chosen and tested (tests/verify-drop.test.ts):
 * - 200 for every answer the ledger gave, including `{"state":"unknown"}`: "Novera sealed no
 *   report with this digest" is a finding about the digest, not a missing endpoint, and a
 *   caller reads one shape for all four states.
 * - 400 `{"state":"malformed"}` when the path is not a SHA-256 digest.
 * - 503 `{"state":"unavailable"}` when the ledger could not be read: nothing is concluded.
 *
 * Answers are cached publicly for 30 seconds, so a withdrawal can take up to 30 seconds to show
 * here (the receipt page itself is never cached). Refusals are not cached.
 */

export const VERIFY_ANSWER_CACHE = "public, max-age=30, s-maxage=30";

const COMMON = { "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } as const;

export async function verifyAnswer(
  rawHash: string,
  lookup: (digest: string) => Promise<SealReceipt | "unavailable">,
): Promise<Response> {
  const digest = normaliseDigest(decodeURIComponentSafe(rawHash));
  if (!digest) {
    return Response.json(
      { state: "malformed", error: "Not a SHA-256 digest: 64 characters, digits and a to f." },
      { status: 400, headers: { ...COMMON, "Cache-Control": "no-store" } },
    );
  }
  const receipt = await lookup(digest);
  if (receipt === "unavailable") {
    return Response.json(
      { state: "unavailable", digest },
      { status: 503, headers: { ...COMMON, "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  return Response.json(receipt, { status: 200, headers: { ...COMMON, "Cache-Control": VERIFY_ANSWER_CACHE } });
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
