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
  /** Optional HTML part, from `src/lib/mail/templates.ts`, where every variable is escaped. */
  html?: string;
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
        ...(args.html ? { html: args.html } : {}),
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

/**
 * Why an email did not go, in words for the person who pressed the button — never the key, never
 * the provider's full answer. "Email is not available here" was the only sentence for every failure,
 * which hid for a week that the mail service was refusing the sending domain (2026-10-08).
 */
export function mailProblem(error: string | null): string {
  const e = error ?? "";
  if (/not configured/i.test(e)) return "email is not set up on this server.";
  if (/domain.*not verified|not verified.*domain/i.test(e)) return "the mail service has not verified Novera's sending domain yet.";
  if (/did not answer|timeout|timed out/i.test(e)) return "the mail service did not answer in time.";
  if (/^(401|403)\b/.test(e)) return "the mail service refused Novera's credentials.";
  if (/^429\b/.test(e)) return "the mail service is rate limiting us; try again in a minute.";
  return "the mail service refused it.";
}

/** Whether this server has what it needs to send at all — said before a form is used, not after. */
export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}
