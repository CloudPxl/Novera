"use server";

import { revalidatePath } from "next/cache";
import { serviceClient } from "@/lib/supabase/service.ts";
import { requireStaff } from "@/lib/auth/staff.ts";
import { createRoutedChat } from "@/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "@/lib/router/routes.ts";
import { connectionsFromEnv } from "@/lib/providers/registry.ts";
import { checkEscalation, withSources } from "./escalate.ts";
import { draftAnswer, type DocPage } from "./answer.ts";
import { sendEmail } from "@/lib/mail/send.ts";
import {
  rateLimit, fingerprint, callerAddress, refusalMessage,
  SUPPORT_LIMIT, APPLY_LIMIT,
} from "./rate-limit.ts";
import { MESSAGE_MIN, MESSAGE_MAX, EMAIL_MAX, ORGANISATION_MAX } from "./limits.ts";

export interface InboundState {
  error?: string;
  notice?: string;
}

/**
 * Hashed, never stored raw: enough to spot a flood, not enough to track a person.
 *
 * Salted with the key the product already holds. The previous version hashed the
 * address with a fixed literal, which is a lookup table for anyone who can read the
 * column — there are only four billion addresses to try.
 */
async function requestFingerprint(): Promise<string | null> {
  const ip = await callerAddress();
  return ip ? fingerprint(["ip", ip]) : null;
}

function readContact(form: FormData): { email: string; message: string; organisation: string | null } | string {
  const email = String(form.get("email") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  const organisation = String(form.get("organisation") ?? "").trim();

  if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return "Enter an email address we can reply to.";
  if (message.length < MESSAGE_MIN) return "Tell us a little more than that.";
  if (message.length > MESSAGE_MAX) return "That is longer than this form can take — email us instead.";
  if (email.length > EMAIL_MAX) return "That email address is too long to be one.";
  // Bounded before it is stored rather than after. Every other field had a limit and
  // this one was free, which is all an abusive payload needs.
  if (organisation.length > ORGANISATION_MAX) return "Shorten the organisation name a little.";

  return { email, message, organisation: organisation || null };
}

/**
 * A question from the public support form.
 *
 * Nothing is sent from here. A consequential question is escalated before a model is
 * ever asked; anything else gets a draft that a person still has to approve.
 */
export async function submitSupportRequest(_prev: InboundState, form: FormData): Promise<InboundState> {
  const contact = readContact(form);
  if (typeof contact === "string") return { error: contact };

  const db = serviceClient();

  // Counted per person and per form: asking a question and applying for a trial are
  // different acts, and one should not spend the other's allowance.
  const who = fingerprint(["support", contact.email, await callerAddress()]);
  // When the count cannot be read the question is still taken — a person reads every one —
  // but no model is asked to draft an answer, since nothing would bound how many it drafts.
  const limit = await rateLimit(who, SUPPORT_LIMIT, { onError: "allow" });
  if (!limit.allowed) return { error: refusalMessage(limit.retryAfterMinutes) };

  // The same question sent twice is one question. Accepted, acknowledged, and not
  // drafted again — silently dropping it would teach someone to press the button
  // harder, and drafting it again costs a model call to produce the same answer.
  const { data: already } = await db
    .from("inbound_requests")
    .select("id")
    .eq("kind", "support")
    .eq("email", contact.email)
    .eq("message", contact.message)
    .gte("created_at", new Date(Date.now() - SUPPORT_LIMIT.windowSeconds * 1000).toISOString())
    .maybeSingle();

  if (already) {
    return {
      notice:
        "Thank you — that has reached us. A person reads every message here, so you will get a reply from a human rather than an automatic one.",
    };
  }

  const escalation = checkEscalation(contact.message);

  const { data: request, error } = await db
    .from("inbound_requests")
    .insert({
      kind: "support",
      email: contact.email,
      organisation: contact.organisation,
      message: contact.message,
      status: escalation.escalate ? "escalated" : "new",
      escalation_reason: escalation.reason,
      source_ip_hash: await requestFingerprint(),
    })
    .select("id")
    .single();

  if (error) return { error: "We could not record that. Try again in a moment." };

  if (!escalation.escalate && limit.counted) {
    // Drafting happens inline so the queue is useful the moment it is opened. A
    // failure here is not the asker's problem: their question is already recorded.
    const { data: pages } = await db
      .from("doc_pages").select("slug, title, body").eq("published", true).order("slug");

    const drafted = await draftAnswer({
      chat: createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES }),
      question: contact.message,
      pages: (pages ?? []) as DocPage[],
    });

    if (drafted.answered && drafted.body) {
      await db.from("reply_drafts").insert({
        request_id: request.id,
        body: drafted.body,
        citations: drafted.citations,
        model: drafted.model,
      });
      await db.from("inbound_requests").update({ status: "drafted" }).eq("id", request.id);
    } else {
      await db
        .from("inbound_requests")
        .update({ status: "escalated", escalation_reason: drafted.reason })
        .eq("id", request.id);
    }
  }

  revalidatePath("/inbox");
  return {
    notice:
      "Thank you — that has reached us. A person reads every message here, so you will get a reply from a human rather than an automatic one.",
  };
}

/** A trial application. Always reviewed by a person; nothing is auto-answered. */
export async function submitTrialApplication(_prev: InboundState, form: FormData): Promise<InboundState> {
  const contact = readContact(form);
  if (typeof contact === "string") return { error: contact };

  const who = fingerprint(["apply", contact.email, await callerAddress()]);
  // Allowed when the count cannot be read: an application is stored for a person to read
  // and calls no model.
  const limit = await rateLimit(who, APPLY_LIMIT, { onError: "allow" });
  if (!limit.allowed) return { error: refusalMessage(limit.retryAfterMinutes) };

  const db = serviceClient();

  // The same suppression the support form has. Two forms whose behaviour differs on
  // something neither of them is about is two products: a double-click here put two
  // identical applications in the queue for a person to read twice.
  const { data: already } = await db
    .from("inbound_requests")
    .select("id")
    .eq("kind", "trial_application")
    .eq("email", contact.email)
    .eq("message", contact.message)
    .gte("created_at", new Date(Date.now() - APPLY_LIMIT.windowSeconds * 1000).toISOString())
    .maybeSingle();

  if (already) {
    return { notice: "Thank you — we read these ourselves and will come back to you." };
  }

  const { error } = await db.from("inbound_requests").insert({
    kind: "trial_application",
    email: contact.email,
    organisation: contact.organisation,
    message: contact.message,
    status: "new",
    source_ip_hash: await requestFingerprint(),
  });

  if (error) return { error: "We could not record that. Try again in a moment." };

  revalidatePath("/inbox");
  return { notice: "Thank you — we read these ourselves and will come back to you." };
}

/** Writes a new draft, superseding whatever was drafted before. */
export async function writeDraft(_prev: InboundState, form: FormData): Promise<InboundState> {
  await requireStaff();
  const requestId = String(form.get("requestId") ?? "");
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "A draft cannot be empty." };

  const db = serviceClient();
  const { error } = await db.from("reply_drafts").insert({
    request_id: requestId,
    body,
    citations: [],
    model: null,
  });

  if (error) return { error: `Could not save the draft: ${error.message}` };

  await db.from("inbound_requests").update({ status: "drafted" }).eq("id", requestId);
  revalidatePath("/inbox");
  return { notice: "Saved as a new draft. The previous wording is kept." };
}

export async function approveDraft(_prev: InboundState, form: FormData): Promise<InboundState> {
  const user = await requireStaff();
  const draftId = String(form.get("draftId") ?? "");
  const db = serviceClient();

  const { data: draft } = await db
    .from("reply_drafts").select("id, request_id, status").eq("id", draftId).single();
  if (!draft) return { error: "That draft could not be found." };
  if (draft.status !== "draft") return { error: `This draft is already ${draft.status}.` };

  const { error } = await db
    .from("reply_drafts")
    .update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() })
    .eq("id", draftId);

  if (error) return { error: `Could not approve it: ${error.message}` };

  await db.from("inbound_requests").update({ status: "approved" }).eq("id", draft.request_id);
  revalidatePath("/inbox");
  return { notice: "Approved. It is not sent until you send it." };
}

/**
 * Sends an approved reply.
 *
 * The send result is written before the status moves, so a reply that failed to send
 * is never left looking as though it went out.
 */
export async function sendDraft(_prev: InboundState, form: FormData): Promise<InboundState> {
  await requireStaff();
  const draftId = String(form.get("draftId") ?? "");
  const db = serviceClient();

  const { data: draft } = await db
    .from("reply_drafts").select("id, request_id, body, citations, status").eq("id", draftId).single();
  if (!draft) return { error: "That draft could not be found." };
  if (draft.status === "sent") return { error: "This reply has already been sent." };
  if (draft.status !== "approved") return { error: "Approve it before sending it." };

  const { data: request } = await db
    .from("inbound_requests").select("email, message").eq("id", draft.request_id).single();
  if (!request) return { error: "The original message could not be found." };

  const result = await sendEmail({
    to: request.email as string,
    subject: "Re: your question about Novera",
    text: `${withSources(
      draft.body as string,
      Array.isArray(draft.citations) ? (draft.citations as string[]) : [],
      process.env.NEXT_PUBLIC_APP_URL,
    )}\n\n— Novera\n\n\nYou asked:\n${(request.message as string).slice(0, 600)}`,
  });

  if (!result.ok) {
    await db.from("reply_drafts").update({ send_error: result.error }).eq("id", draftId);
    revalidatePath("/inbox");
    return { error: `Not sent: ${result.error}` };
  }

  const { error } = await db
    .from("reply_drafts")
    .update({ status: "sent", sent_at: new Date().toISOString(), send_error: null })
    .eq("id", draftId);

  if (error) return { error: `It was sent, but the record did not update: ${error.message}` };

  await db.from("inbound_requests").update({ status: "sent" }).eq("id", draft.request_id);
  revalidatePath("/inbox");
  return { notice: `Sent to ${request.email}.` };
}

/** Takes a request off the queue without replying. */
export async function closeRequest(_prev: InboundState, form: FormData): Promise<InboundState> {
  await requireStaff();
  const requestId = String(form.get("requestId") ?? "");
  const db = serviceClient();
  const { error } = await db.from("inbound_requests").update({ status: "closed" }).eq("id", requestId);
  if (error) return { error: `Could not close it: ${error.message}` };
  revalidatePath("/inbox");
  return { notice: "Closed." };
}


/**
 * Erases a message and every draft written for it.
 *
 * Needed because the person who wrote to us may ask for it, and because they are not
 * a customer — they have no workspace, so nothing else in the product can reach their
 * data. Deleting drafts one at a time stays refused; this removes the whole request
 * in one authorised act and records that it happened.
 */
export async function eraseRequest(_prev: InboundState, form: FormData): Promise<InboundState> {
  const user = await requireStaff();
  const requestId = String(form.get("requestId") ?? "");
  if (String(form.get("confirm")) !== "erase") return { error: "Not erased." };

  const db = serviceClient();
  const { data, error } = await db.rpc("erase_inbound_request", {
    target: requestId,
    requested_by: user.id,
  });

  if (error) return { error: `Could not erase it: ${error.message}` };

  revalidatePath("/inbox");
  const removed = (data as { drafts_removed?: number } | null)?.drafts_removed ?? 0;
  return { notice: `Erased, along with ${removed} draft${removed === 1 ? "" : "s"}. Only a record that it happened remains.` };
}
