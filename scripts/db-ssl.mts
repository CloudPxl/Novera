/**
 * How the database scripts connect over TLS. One place, so they cannot differ.
 *
 * - A database on this machine (the local Supabase stack) has no TLS: none is asked for.
 * - With SUPABASE_DB_CA pointing at Supabase's CA certificate (dashboard → Project Settings
 *   → Database → SSL certificate), the server's certificate is verified.
 * - Otherwise the connection is encrypted but the certificate is not verified — what every
 *   script did before, and the audit's R5: someone able to intercept the connection could
 *   present their own certificate and see the database password. Set SUPABASE_DB_CA.
 */
import { readFileSync } from "node:fs";

export function sslFor(connectionString: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const host = new URL(connectionString).hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return false;
  const caPath = process.env.SUPABASE_DB_CA;
  if (caPath) return { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") };
  return { rejectUnauthorized: false };
}
