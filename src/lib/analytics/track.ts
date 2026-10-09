import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../supabase/service.ts";
import { checkProperties, type ProductEvent } from "./events.ts";

/**
 * Records one first-party product event (0062). Never throws, never sends anything to a
 * third party, and never holds a request for more than INSERT_DEADLINE_MS. Awaited rather
 * than deferred with Next's `after`: this module is also loaded by the scripts and
 * verifiers (through start-run.ts), which run outside Next, where `next/server` does not
 * resolve.
 *
 * What is stored: the event name, the workspace (when there is one), a salted HMAC of the
 * actor (when `NOVERA_EVENTS_SALT` is set — otherwise no actor at all, never an unsalted
 * hash), the checked properties, the time. Never a user id, an email, an IP, a user agent or
 * a report token.
 *
 * Switched off entirely with `NOVERA_PRODUCT_EVENTS=off`. On by default: these are aggregate
 * first-party counts with no identifier, stored in Novera's own database in Frankfurt, which
 * is the boundary docs/setup/product-events.md draws. Sending any of this to an external
 * analytics tool is a different thing — it needs a consent decision first.
 */

export function eventsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOVERA_PRODUCT_EVENTS !== "off";
}

/** A salted, keyed hash of a user id: stable per person, useless without the salt. */
export function actorHash(userId: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  const salt = env.NOVERA_EVENTS_SALT;
  if (!userId || !salt || salt.length < 16) return null;
  return createHmac("sha256", salt).update(`novera-product-events:${userId}`).digest("hex");
}

export interface TrackInput {
  workspaceId?: string | null;
  /** The signed-in person, hashed before it is stored. */
  userId?: string | null;
  properties?: Record<string, unknown>;
  /** Defaults to the service-role client: the table takes no client writes. */
  client?: SupabaseClient;
}

/** A count is not worth a slow page: past this the insert is abandoned. */
const INSERT_DEADLINE_MS = 1_500;

async function insert(event: ProductEvent, input: TrackInput): Promise<void> {
  try {
    const checked = checkProperties(event, input.properties ?? {});
    if (!checked.ok) {
      console.error(`[novera:events] ${event} refused: ${checked.reason}`);
      return;
    }
    const { error } = await (input.client ?? serviceClient()).from("product_events").insert({
      event,
      workspace_id: input.workspaceId ?? null,
      actor_hash: actorHash(input.userId),
      properties: checked.properties,
    }).abortSignal(AbortSignal.timeout(INSERT_DEADLINE_MS));
    // The table may not exist yet on a database 0062 has not reached; that is not the request's problem.
    if (error) console.error(`[novera:events] ${event} not stored (${error.code ?? "error"})`);
  } catch {
    // Counting must never become a failure of the thing being counted.
  }
}

export async function track(event: ProductEvent, input: TrackInput = {}): Promise<void> {
  if (!eventsEnabled()) return;
  await insert(event, input);
}
