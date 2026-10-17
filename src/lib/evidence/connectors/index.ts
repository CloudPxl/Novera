import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revealSecret } from "../../store/secrets.ts";
import { httpVerificationConnector, type HttpVerificationConfig } from "./http.ts";
import type { NotFoundMeaning, VerificationConnector } from "./types.ts";

export type VerificationConfig = HttpVerificationConfig;

export function isVerificationConfig(value: unknown): value is VerificationConfig {
  const c = value as Record<string, unknown> | null;
  return Boolean(c && c.kind === "http_read" && typeof c.url === "string" && c.url);
}

/**
 * What the agent's read-back settings say a 404 means, as stored. Anything but the one
 * declaration is the default: an unknown or malformed value never turns a 404 into a finding.
 */
export function storedNotFoundMeaning(verification: unknown): NotFoundMeaning {
  return isVerificationConfig(verification) && verification.not_found_means === "contradicted" ? "contradicted" : "unavailable";
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
  /**
   * How a 404 is read, when the caller must not take it from the row: a run passes the value its
   * manifest froze when it started, so changing the setting mid-run changes nothing already
   * declared. Omitted, the stored setting applies (a single-scenario check, which seals nothing).
   */
  notFoundMeans?: NotFoundMeaning;
}): Promise<VerificationConnector | null> {
  if (!isVerificationConfig(args.verification)) return null;

  const secret = await revealSecret({
    client: args.client,
    workspaceId: args.workspaceId,
    scope: "verification_auth",
    agentId: args.agentId,
  });

  const config: VerificationConfig = { ...args.verification };
  delete config.not_found_means;
  if ((args.notFoundMeans ?? storedNotFoundMeaning(args.verification)) === "contradicted") config.not_found_means = "contradicted";
  return httpVerificationConnector(config, secret?.value);
}

export { httpVerificationConnector };
export type { VerificationConnector, VerificationObservation, ObservationStatus, NotFoundMeaning } from "./types.ts";
