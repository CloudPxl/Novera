import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * How a receiver knows a webhook came from Novera: `Novera-Signature: t=<unix>,v1=<hex>`,
 * the HMAC-SHA256 of `<t>.<body>` under the endpoint's signing secret. The timestamp is
 * inside what is signed, so an old delivery replayed later fails the freshness check.
 * Written to be copied into a receiver: no dependency beyond node:crypto.
 */

export const SIGNATURE_HEADER = "novera-signature";

export function signatureFor(secret: string, body: string, timestamp: number): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** True when the header is a valid signature of this body, at most `toleranceSeconds` old. */
export function verifySignature(args: {
  secret: string;
  body: string;
  header: string | null | undefined;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const parts = Object.fromEntries((args.header ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  const now = Math.floor((args.now ?? Date.now()) / 1000);
  if (Math.abs(now - t) > (args.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signatureFor(args.secret, args.body, t).split("v1=")[1], "hex");
  const given = Buffer.from(parts.v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
