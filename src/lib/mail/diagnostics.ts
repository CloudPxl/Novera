import { lifecycleEmailsEnabled } from "./templates.ts";

/**
 * Whether this server is set up to send email, read from its environment only.
 *
 * No network call, and no secret in the answer: the key is reported as present or absent and
 * whether it has the `re_` shape Resend keys have, never its value, length or any part of it.
 * Whether Resend has verified the domain, and what Supabase's SMTP settings hold, cannot be read
 * from here at all — the app's key can only send, and SMTP lives in a dashboard — so the answer
 * says that rather than guessing (docs/setup/email-checklist.md).
 */
export interface MailDiagnostics {
  resendKey: { present: boolean; shape: "re_" | "unexpected" | null };
  from: { present: boolean; domain: string | null; expectedDomain: string; matchesExpected: boolean | null; wellFormed: boolean | null };
  appUrl: { present: boolean; origin: string | null; https: boolean | null };
  canonicalHost: string;
  /** Whether NEXT_PUBLIC_APP_URL's host is the canonical host. Null when there is no app URL. */
  appUrlIsCanonical: boolean | null;
  environment: "production" | "preview" | "development" | "local";
  staffConfigured: number;
  lifecycleEmails: boolean;
  /** What only a dashboard can show. Always present, so nobody reads its absence as a pass. */
  unreadable: string[];
  /** What to fix, in order, worded as the step to take. Empty when nothing here is wrong. */
  problems: string[];
  /** Everything this server can check says it can send. Delivery is still unproven until a test arrives. */
  configured: boolean;
}

export const EXPECTED_FROM_DOMAIN = "nover.space";

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function mailDiagnostics(env: Record<string, string | undefined> = process.env): MailDiagnostics {
  const key = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.RESEND_FROM_EMAIL ?? "").trim();
  const fromMatch = /^[^\s@<>]+@([^\s@<>]+\.[^\s@<>]+)$/.exec(from);
  const domain = fromMatch ? fromMatch[1].toLowerCase() : null;
  const appOrigin = originOf(env.NEXT_PUBLIC_APP_URL);
  const canonicalHost = env.CANONICAL_HOST ?? "www.nover.space";
  const environment = env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "preview"
    : env.NODE_ENV === "development" ? "development" : "local";
  const staff = (env.NOVERA_STAFF_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean).length;

  const d: MailDiagnostics = {
    resendKey: { present: key.length > 0, shape: key ? (key.startsWith("re_") ? "re_" : "unexpected") : null },
    from: {
      present: from.length > 0,
      domain,
      expectedDomain: EXPECTED_FROM_DOMAIN,
      matchesExpected: domain ? domain === EXPECTED_FROM_DOMAIN : null,
      wellFormed: from ? Boolean(fromMatch) : null,
    },
    appUrl: { present: Boolean(env.NEXT_PUBLIC_APP_URL), origin: appOrigin, https: appOrigin ? appOrigin.startsWith("https://") : null },
    canonicalHost,
    appUrlIsCanonical: appOrigin ? new URL(appOrigin).host === canonicalHost : null,
    environment,
    staffConfigured: staff,
    lifecycleEmails: lifecycleEmailsEnabled(env),
    unreadable: [
      "Whether Resend has verified nover.space: the app's key can only send. Resend → Domains shows it.",
      "Supabase's custom SMTP settings (host, port, sender, rate limit): they live in the Supabase dashboard and cannot be read from the app.",
      "Whether any message was delivered: Resend → Logs, and Supabase → Logs → Auth.",
    ],
    problems: [],
    configured: false,
  };

  if (!d.resendKey.present) d.problems.push("RESEND_API_KEY is empty. Set it in Vercel → Settings → Environment Variables (Production), then redeploy.");
  else if (d.resendKey.shape !== "re_") d.problems.push("RESEND_API_KEY does not look like a Resend key (they start with re_). Paste the key again from Resend → API Keys.");
  if (!d.from.present) d.problems.push(`RESEND_FROM_EMAIL is empty. Set it to no-reply@${EXPECTED_FROM_DOMAIN}, then redeploy.`);
  else if (!d.from.wellFormed) d.problems.push(`RESEND_FROM_EMAIL is not a bare address. Use no-reply@${EXPECTED_FROM_DOMAIN}; the display name is added by Novera.`);
  else if (d.from.matchesExpected === false) d.problems.push(`RESEND_FROM_EMAIL is at ${domain}, not ${EXPECTED_FROM_DOMAIN}. Resend sends only from a verified domain.`);
  if (!d.appUrl.present) d.problems.push("NEXT_PUBLIC_APP_URL is empty. Emailed links fall back to the canonical address; set it to https://www.nover.space in production.");
  else if (!d.appUrl.origin) d.problems.push("NEXT_PUBLIC_APP_URL is not a URL.");
  else if (environment === "production" && (d.appUrl.https === false || d.appUrlIsCanonical === false)) {
    d.problems.push(`NEXT_PUBLIC_APP_URL is ${d.appUrl.origin}; production links must use https://${canonicalHost}.`);
  }

  d.configured = d.resendKey.shape === "re_" && Boolean(d.from.wellFormed) && d.from.matchesExpected === true;
  return d;
}

/**
 * The one line shown to owners and admins where invitations are sent: what happens, not why.
 * Null when this server has what it needs (delivery itself is then shown per invitation).
 */
export function invitationMailLine(d: MailDiagnostics): string | null {
  if (!d.resendKey.present || !d.from.present) {
    return "This server cannot send email yet, so an invitation gives you a link to send them yourself.";
  }
  if (!d.configured) {
    return "This server's email settings are incomplete, so an invitation email may not arrive. The link is shown to you either way; send it yourself if it does not.";
  }
  return null;
}
