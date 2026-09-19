import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM sealing for customer-supplied credentials (agent auth headers, judge
 * model keys). Server-side only: this module must never be imported from a client
 * component.
 *
 * `aad` binds a ciphertext to its context (workspace + scope), so a row copied into
 * a different workspace fails to open rather than silently decrypting.
 */
export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
}

const KEY_BYTES = 32;

export function encryptionKey(raw = process.env.NOVERA_ENCRYPTION_KEY): Buffer {
  if (!raw) {
    throw new Error("NOVERA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`NOVERA_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function seal(plaintext: string, aad: string, key: Buffer = encryptionKey()): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function open(sealed: Sealed, aad: string, key: Buffer = encryptionKey()): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Context string that a sealed value is bound to. */
export function secretAad(workspaceId: string, scope: string, subjectId = ""): string {
  return `novera:${workspaceId}:${scope}:${subjectId}`;
}

/** Constant-time compare for share tokens. */
export function tokenMatches(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
