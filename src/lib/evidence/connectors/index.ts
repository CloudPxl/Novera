import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revealSecret } from "../../store/secrets.ts";
import { httpVerificationConnector, type HttpVerificationConfig } from "./http.ts";
import type { VerificationConnector } from "./types.ts";

export type VerificationConfig = HttpVerificationConfig;

export function isVerificationConfig(value: unknown): value is VerificationConfig {
  const c = value as Record<string, unknown> | null;
  return Boolean(c && c.kind === "http_read" && typeof c.url === "string" && c.url);
}

/**
 * Turns a stored `agents.verification` row into something that can look.
 *
 * Returns null when nothing is configured, which is the normal case and not an
 * error: the scenario then reports the effect as unverified rather than passed. The
 * credential is decrypted here and handed to the connector, never returned or stored.
 */
export async function buildVerifier(args: {
  client: SupabaseClient;
  workspaceId: string;
  agentId: string;
  verification: unknown;
}): Promise<VerificationConnector | null> {
  if (!isVerificationConfig(args.verification)) return null;

  const secret = await revealSecret({
    client: args.client,
    workspaceId: args.workspaceId,
    scope: "verification_auth",
    agentId: args.agentId,
  });

  return httpVerificationConnector(args.verification, secret?.value);
}

export { httpVerificationConnector };
export type { VerificationConnector, VerificationObservation, ObservationStatus } from "./types.ts";
