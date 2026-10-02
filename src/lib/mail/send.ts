import "server-only";
import { readJsonLimited } from "../net/read-body.ts";

const MAIL_TIMEOUT_MS = 10_000;

/**
 * Sending one email through Resend.
 *
 * Deliberately tiny and deliberately the only path out. Everything that leaves Novera
 * for a person's inbox goes through here, so there is one place to look when asking
 * "what did we send, and who approved it".
 *
 * It reports failure rather than throwing it away. A reply that was marked sent but
 * never arrived is the worst outcome available, so the send result is written to the
 * draft row before the status moves.
 */
export interface SendResult {
  ok: boolean;
  id: string | null;
  error: string | null;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    return { ok: false, id: null, error: "Email is not configured on this server (RESEND_API_KEY / RESEND_FROM_EMAIL)." };
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: `Novera <${from}>`,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
      // Called from a request that has its own platform limit: a mail API that hangs must
      // not take the request with it.
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { ok: false, id: null, error: `The mail service did not answer within ${MAIL_TIMEOUT_MS / 1000} s.` };
    }
    return { ok: false, id: null, error: error instanceof Error ? error.message : String(error) };
  }

  let payload: Record<string, unknown> | null;
  try {
    payload = await readJsonLimited(response, 64 * 1024);
  } catch {
    // Too large, or it stopped arriving: the status is still the answer.
    payload = null;
  }

  if (!response.ok) {
    const detail = (payload?.message as string | undefined) ?? response.statusText;
    return { ok: false, id: null, error: `${response.status}: ${detail}` };
  }

  return { ok: true, id: (payload?.id as string | undefined) ?? null, error: null };
}
