"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { assertPublicUrl, PrivateAddressError } from "@/lib/net/public-url.ts";
import { createEndpoint, deliverDue, enqueue, WEBHOOK_EVENTS, appOrigin, type WebhookEvent } from "@/lib/webhooks/deliver.ts";

export interface WebhookFormState {
  error?: string;
  notice?: string;
  /** The signing secret, returned exactly once. Novera keeps it sealed and never shows it again. */
  secret?: string;
}

const MAX_ACTIVE_ENDPOINTS = 5;

/** Adds an endpoint. Its signing secret is in the reply and nowhere else a person can see. */
export async function createWebhook(_prev: WebhookFormState, form: FormData): Promise<WebhookFormState> {
  const { user, workspace } = await requireWorkspace();
  const url = String(form.get("url") ?? "").trim();
  const events = WEBHOOK_EVENTS.filter((e) => form.get(`event:${e}`) === "on");
  if (!url) return { error: "Enter the address Novera should send events to." };
  if (!events.length) return { error: "Choose at least one event to send." };

  let parsed: URL;
  try {
    parsed = await assertPublicUrl(url);
  } catch (e) {
    return { error: e instanceof PrivateAddressError ? e.message : "That address is not valid." };
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return { error: "Use https. A webhook carries a signature and links to your reports." };
  }

  const admin = await assertMembership(user.id, workspace.id);
  const { count } = await admin.from("webhook_endpoints").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id).is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_ENDPOINTS) {
    return { error: `This workspace already has ${MAX_ACTIVE_ENDPOINTS} endpoints. Revoke one you no longer use first.` };
  }

  try {
    const { secret } = await createEndpoint({ db: admin, workspaceId: workspace.id, url: parsed.toString(), events, createdBy: user.id });
    revalidatePath("/settings");
    return { secret, notice: "Copy the signing secret now. Novera keeps it sealed and cannot show it again." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The endpoint could not be saved." };
  }
}

/** Revokes an endpoint for good. Nothing more is sent to it, including queued retries. */
export async function revokeWebhook(_prev: WebhookFormState, form: FormData): Promise<WebhookFormState> {
  const { user, workspace } = await requireWorkspace();
  const endpointId = String(form.get("endpointId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);
  const { data, error } = await admin.from("webhook_endpoints")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", endpointId).eq("workspace_id", workspace.id).is("revoked_at", null)
    .select("id");
  if (error) return { error: `The endpoint could not be revoked: ${error.message}` };
  if (!data?.length) return { error: "That endpoint was not found, or is already revoked." };
  revalidatePath("/settings");
  return { notice: "Revoked. Nothing more is sent to it." };
}

/** Sends one signed test event now, and says what the endpoint answered. */
export async function sendTestWebhook(_prev: WebhookFormState, form: FormData): Promise<WebhookFormState> {
  const { user, workspace } = await requireWorkspace();
  const endpointId = String(form.get("endpointId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);
  const ids = await enqueue({
    db: admin, workspaceId: workspace.id, event: "test", subjectId: null, onlyEndpoint: endpointId,
    body: { test: true, note: "A test event from Novera. Check the signature, then ignore it.", workspace_url: `${appOrigin()}/settings` },
  });
  if (!ids.length) return { error: "That endpoint was not found, or is revoked." };
  await deliverDue({ db: admin, ids, deadline: Date.now() + 8_000 });
  const { data: d } = await admin.from("webhook_deliveries").select("status, last_status, last_error").eq("id", ids[0]).single();
  revalidatePath("/settings");
  return d?.status === "delivered"
    ? { notice: `Delivered: your endpoint answered ${d.last_status}.` }
    : { error: `Not delivered: ${d?.last_error ?? "no answer"}. It will be retried.` };
}

export type { WebhookEvent };
