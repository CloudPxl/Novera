/**
 * Every email Novera writes, as versioned templates: plain text plus a minimal HTML part.
 *
 * Pure and browser-safe (no `server-only`): the preview page and the tests render them with
 * sample data, and nothing in this file can send. Sending is `src/lib/mail/send.ts`, and only
 * the invitation and the approved support reply call it.
 *
 * Every variable is escaped before it reaches the HTML part, and a link is a link only when it
 * is an absolute http(s) URL; anything else is printed as text. A subject never carries a line
 * break. A workspace name or a support reply is text a person typed: it is never markup.
 *
 * The three Supabase auth templates are not sent from here. They are rendered once, with
 * Supabase's own `{{ .ConfirmationURL }}` left in place, into `docs/setup/email-templates/` for
 * pasting into the dashboard; `tests/mail-templates.test.ts` holds those files to this source.
 */

export type AppTemplateId =
  | "invitation"
  | "support_reply"
  | "lifecycle.run_finished"
  | "lifecycle.report_ready"
  | "lifecycle.trial_ending"
  | "lifecycle.trial_used"
  | "lifecycle.schedule_paused";

export type AuthTemplateId = "auth.confirm_signup" | "auth.reset_password" | "auth.change_email";

export type TemplateId = AppTemplateId | AuthTemplateId;

/** Bumped when a template's wording or structure changes, so a sent message can be traced to it. */
export const TEMPLATE_VERSION: Record<TemplateId, number> = {
  invitation: 1,
  support_reply: 1,
  "lifecycle.run_finished": 1,
  "lifecycle.report_ready": 1,
  "lifecycle.trial_ending": 1,
  "lifecycle.trial_used": 1,
  "lifecycle.schedule_paused": 1,
  "auth.confirm_signup": 1,
  "auth.reset_password": 1,
  "auth.change_email": 1,
};

export interface RenderedEmail {
  template: TemplateId;
  version: number;
  subject: string;
  text: string;
  html: string;
}

// ===================================================================== escaping

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** A subject is one line of plain text, whatever a variable inside it contained. */
export function oneLine(value: unknown, max = 200): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** An absolute http(s) URL, or null. `javascript:`, `data:` and relative paths never become links. */
export function safeUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Text a person wrote, as HTML: escaped, line breaks kept, nothing interpreted. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

const FOOTER_TEXT = "Novera · evidence of testing for AI support agents · https://www.nover.space";

/**
 * The one HTML shell. Inline styles only (mail clients drop <style> and external sheets), no
 * images, no tracking pixel, no script. `bodyHtml` and `href` arrive already escaped.
 */
function shell(args: { title: string; bodyHtml: string; action?: { label: string; href: string }; footerHtml?: string }): string {
  const button = args.action
    ? `<p style="margin:24px 0"><a href="${args.action.href}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(args.action.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#4b5563">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${args.action.href}</span></p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(args.title)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827">
<p style="margin:0 0 24px;font-weight:700;letter-spacing:-0.01em">Novera</p>
${args.bodyHtml}
${button}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px">
<p style="margin:0;font-size:12px;color:#6b7280">${args.footerHtml ?? escapeHtml(FOOTER_TEXT)}</p>
</div>
</body>
</html>
`;
}

function render(template: TemplateId, subject: string, text: string, html: string): RenderedEmail {
  return { template, version: TEMPLATE_VERSION[template], subject: oneLine(subject), text, html };
}

/** A link in the HTML part: escaped when it is one, plain text when it is not. */
function linkAction(label: string, url: string): { label: string; href: string } | undefined {
  const safe = safeUrl(url);
  return safe ? { label, href: escapeHtml(safe) } : undefined;
}

// ================================================================ transactional

export interface InvitationData {
  inviterName: string;
  workspaceName: string;
  roleLabel: string;
  /** The invitation link. Its token is the only way in; it is shown once in the app too. */
  link: string;
  email: string;
  expiresInDays?: number;
}

export function invitationEmail(d: InvitationData): RenderedEmail {
  const days = d.expiresInDays ?? 7;
  const role = d.roleLabel.toLowerCase();
  const lead = `${d.inviterName} invited you to the workspace "${d.workspaceName}" on Novera, as ${role}.`;
  const terms = `The link works once, for ${d.email}, and expires in ${days === 7 ? "seven" : days} days. If you did not expect this, ignore it: nothing happens unless you accept.`;
  const text = [lead, "", `Accept: ${d.link}`, "", terms, "", "—", FOOTER_TEXT].join("\n");
  const html = shell({
    title: "Your Novera invitation",
    bodyHtml: `${paragraphs(lead)}\n${paragraphs(terms)}`,
    action: linkAction("Accept the invitation", d.link),
  });
  return render("invitation", `You are invited to ${oneLine(d.workspaceName, 120)} on Novera`, text, html);
}

export interface SupportReplyData {
  /** The approved draft, word for word. */
  reply: string;
  /** Documentation addresses the reply rests on. */
  sources: string[];
  /** What the person asked, quoted back so the reply stands on its own. */
  question: string;
}

/** The approved support reply. Its text part is what `sendDraft` sent before templates existed. */
export function supportReplyEmail(d: SupportReplyData): RenderedEmail {
  const question = d.question.slice(0, 600);
  const sourcesText = d.sources.length ? `\n\nThis answer is based on:\n${d.sources.join("\n")}` : "";
  const text = `${d.reply}${sourcesText}\n\n— Novera\n\n\nYou asked:\n${question}`;
  const sourcesHtml = d.sources.length
    ? `<p style="margin:0 0 8px">This answer is based on:</p>\n<ul style="margin:0 0 16px;padding-left:20px">${d.sources
        .map((s) => {
          const safe = safeUrl(s);
          return `<li>${safe ? `<a href="${escapeHtml(safe)}" style="color:#1d4ed8">${escapeHtml(safe)}</a>` : escapeHtml(s)}</li>`;
        })
        .join("")}</ul>`
    : "";
  const html = shell({
    title: "Your question about Novera",
    bodyHtml: `${paragraphs(d.reply)}\n${sourcesHtml}\n<p style="margin:0 0 16px">— Novera</p>
<div style="margin-top:24px;padding:12px 14px;border-left:3px solid #e5e7eb;color:#4b5563;font-size:14px"><p style="margin:0 0 6px;font-weight:600">You asked:</p>${paragraphs(question)}</div>`,
  });
  return render("support_reply", "Re: your question about Novera", text, html);
}

// ==================================================================== lifecycle
//
// Templates only. Nothing sends them: there is no caller, and `lifecycleEmailsEnabled()` is off
// unless NOVERA_LIFECYCLE_EMAILS=on, which David sets only after SMTP is verified in production
// and the consent rules below are built (docs/setup/email-checklist.md).

export type LifecycleEvent = "run.completed" | "report.sealed" | "trial.ending" | "trial.used" | "schedule.paused";

/**
 * `service`: about something the person did or set up (a run they started, a schedule they
 * made). Sent only to members who have not opted out.
 * `consent`: nudges toward connecting a key or paying. Sent only to a person who opted in;
 * the default is no.
 */
export type LifecycleBasis = "service" | "consent";

export const LIFECYCLE_EVENTS: Record<LifecycleEvent, { template: AppTemplateId; basis: LifecycleBasis; trigger: string }> = {
  "run.completed": { template: "lifecycle.run_finished", basis: "service", trigger: "A run the person started finished, was stopped, or ended in a failure." },
  "report.sealed": { template: "lifecycle.report_ready", basis: "service", trigger: "A report was sealed for a run the person started." },
  "trial.ending": { template: "lifecycle.trial_ending", basis: "consent", trigger: "The owner has one trial run left." },
  "trial.used": { template: "lifecycle.trial_used", basis: "consent", trigger: "The owner has used every trial run." },
  "schedule.paused": { template: "lifecycle.schedule_paused", basis: "service", trigger: "A schedule paused because a run could not start." },
};

/** Off unless explicitly switched on. Nothing in the application calls a sender with it yet. */
export function lifecycleEmailsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NOVERA_LIFECYCLE_EMAILS === "on";
}

function lifecycleFooter(basis: LifecycleBasis, manageUrl: string): { text: string; html: string } {
  const why = basis === "service"
    ? "You receive this because you started this work in Novera. It is a notification about your own runs, not marketing."
    : "You receive this because you asked to hear about your trial. Novera never sends it without that.";
  const stop = "Stop these emails at any time:";
  const safe = safeUrl(manageUrl);
  return {
    text: `${why}\n${stop} ${manageUrl}\n${FOOTER_TEXT}`,
    html: `${escapeHtml(why)}<br>${escapeHtml(stop)} ${safe ? `<a href="${escapeHtml(safe)}" style="color:#6b7280">${escapeHtml(safe)}</a>` : escapeHtml(manageUrl)}<br>${escapeHtml(FOOTER_TEXT)}`,
  };
}

function lifecycle(template: AppTemplateId, basis: LifecycleBasis, args: { subject: string; lines: string[]; action: { label: string; url: string }; manageUrl: string }): RenderedEmail {
  const footer = lifecycleFooter(basis, args.manageUrl);
  const body = args.lines.join("\n\n");
  const text = [body, "", `${args.action.label}: ${args.action.url}`, "", "—", footer.text].join("\n");
  const html = shell({ title: oneLine(args.subject), bodyHtml: paragraphs(body), action: linkAction(args.action.label, args.action.url), footerHtml: footer.html });
  return render(template, args.subject, text, html);
}

export interface RunFinishedData {
  agentName: string;
  suiteLabel: string;
  /** From the stored rows, as the run page counts them. */
  status: "completed" | "aborted";
  outcome: "pass" | "fail" | "incomplete" | null;
  passed: number;
  failed: number;
  noResult: number;
  runUrl: string;
  manageUrl: string;
}

export function runFinishedEmail(d: RunFinishedData): RenderedEmail {
  const headline = d.status === "aborted"
    ? `The run of ${d.suiteLabel} against ${d.agentName} ended before it finished. No report was sealed.`
    : `The run of ${d.suiteLabel} against ${d.agentName} finished${d.outcome ? `: ${d.outcome}` : ""}.`;
  return lifecycle("lifecycle.run_finished", "service", {
    subject: d.status === "aborted" ? `Run stopped: ${d.agentName}` : `Run finished: ${d.agentName}`,
    lines: [headline, `${d.passed} passed, ${d.failed} failed, ${d.noResult} without a result. A scenario without a result is never counted as a pass.`],
    action: { label: "Open the run", url: d.runUrl },
    manageUrl: d.manageUrl,
  });
}

export interface ReportReadyData {
  agentName: string;
  contentHash: string;
  /** The run page, behind sign-in. Never the report's own link: that link is a bearer token. */
  runUrl: string;
  manageUrl: string;
}

export function reportReadyEmail(d: ReportReadyData): RenderedEmail {
  return lifecycle("lifecycle.report_ready", "service", {
    subject: `Report sealed: ${d.agentName}`,
    lines: [
      `A report was sealed for ${d.agentName}. Its SHA-256 is ${d.contentHash}.`,
      "Sign in to read it, check whether it is ready to send, and share its link. The link itself is never sent by email.",
    ],
    action: { label: "Open the run and its report", url: d.runUrl },
    manageUrl: d.manageUrl,
  });
}

export interface TrialData {
  runsUsed: number;
  runsLimit: number;
  settingsUrl: string;
  manageUrl: string;
}

export function trialEndingEmail(d: TrialData): RenderedEmail {
  const left = Math.max(0, d.runsLimit - d.runsUsed);
  return lifecycle("lifecycle.trial_ending", "consent", {
    subject: `${left} trial run${left === 1 ? "" : "s"} left on Novera`,
    lines: [
      `You have used ${d.runsUsed} of ${d.runsLimit} trial runs.`,
      "To keep running suites, connect your own model key. Grading then runs on your key, and every report says so.",
    ],
    action: { label: "Connect a model key", url: d.settingsUrl },
    manageUrl: d.manageUrl,
  });
}

export function trialUsedEmail(d: TrialData): RenderedEmail {
  return lifecycle("lifecycle.trial_used", "consent", {
    subject: "Your Novera trial runs are used",
    lines: [
      `You have used all ${d.runsLimit} trial runs. Your runs, verdicts and sealed reports stay as they are.`,
      "A new run starts once a model key is connected.",
    ],
    action: { label: "Connect a model key", url: d.settingsUrl },
    manageUrl: d.manageUrl,
  });
}

export interface SchedulePausedData {
  agentName: string;
  /** The reason the schedule stored when it paused. */
  reason: string;
  schedulesUrl: string;
  manageUrl: string;
}

export function schedulePausedEmail(d: SchedulePausedData): RenderedEmail {
  return lifecycle("lifecycle.schedule_paused", "service", {
    subject: `Schedule paused: ${d.agentName}`,
    lines: [`The scheduled run for ${d.agentName} is paused, because a run could not start:`, d.reason, "Nothing runs until you resume it."],
    action: { label: "Open the schedule", url: d.schedulesUrl },
    manageUrl: d.manageUrl,
  });
}

// ============================================================ Supabase auth mail
//
// Pasted into Supabase → Authentication → Emails → Templates. Supabase fills
// `{{ .ConfirmationURL }}` itself (the default PKCE flow, which returns to /auth/callback with a
// one-time code). Novera does not switch these to token_hash links: a token_hash link signs in
// whichever browser opens it, which is the login-CSRF in docs/LAUNCH-READINESS.md row B.

/** Supabase's Go-template variables, left exactly as Supabase expects them. */
export const SUPABASE_VARS = {
  confirmationUrl: "{{ .ConfirmationURL }}",
  email: "{{ .Email }}",
  newEmail: "{{ .NewEmail }}",
} as const;

export const AUTH_TEMPLATE_FILE: Record<AuthTemplateId, string> = {
  "auth.confirm_signup": "confirm-signup.html",
  "auth.reset_password": "reset-password.html",
  "auth.change_email": "change-email.html",
};

/**
 * The auth templates. The variables are Supabase's literal placeholders, inserted as they are:
 * Supabase's own template engine escapes what it substitutes.
 */
export function authTemplate(id: AuthTemplateId): RenderedEmail {
  const url = SUPABASE_VARS.confirmationUrl;
  const action = (label: string) => ({ label, href: url });
  const ignore = "If you did not ask for this, ignore this email. Nothing changes unless the link is opened.";
  const once = "The link works once and expires. Do not forward it: whoever opens it can use it.";
  switch (id) {
    case "auth.confirm_signup":
      return render(id, "Confirm your Novera account", "", shell({
        title: "Confirm your Novera account",
        bodyHtml: `${paragraphs("Confirm your email address to finish creating your Novera account.")}\n${paragraphs(`${once}\n${ignore}`)}`,
        action: action("Confirm my email address"),
      }));
    case "auth.reset_password":
      return render(id, "Reset your Novera password", "", shell({
        title: "Reset your Novera password",
        bodyHtml: `${paragraphs("Someone asked to reset the password of the Novera account for this address. Use the link to choose a new one.")}\n${paragraphs(`${once}\n${ignore}`)}`,
        action: action("Choose a new password"),
      }));
    case "auth.change_email":
      return render(id, "Confirm your new Novera email address", "", shell({
        title: "Confirm your new Novera email address",
        bodyHtml: `<p style="margin:0 0 16px">Confirm that the Novera account for ${SUPABASE_VARS.email} should sign in with ${SUPABASE_VARS.newEmail} from now on.</p>\n${paragraphs(`${once}\nIf you did not ask for this, ignore this email and change your Novera password: the address does not change unless the link is opened.`)}`,
        action: action("Confirm the new address"),
      }));
  }
}

export const AUTH_TEMPLATE_IDS = Object.keys(AUTH_TEMPLATE_FILE) as AuthTemplateId[];

// ===================================================================== previews

const SAMPLE_ORIGIN = "https://www.nover.space";

/**
 * Every template with fake data, for the staff preview page and the tests. Sample values say
 * they are samples; nothing here is a real person, workspace or link.
 */
export const PREVIEWS: Record<TemplateId, () => RenderedEmail> = {
  invitation: () => invitationEmail({
    inviterName: "Sample Inviter", workspaceName: "Sample workspace <b>not bold</b>", roleLabel: "Reviewer",
    link: `${SAMPLE_ORIGIN}/invite/SAMPLE-TOKEN-NOT-REAL`, email: "invitee@example.com",
  }),
  support_reply: () => supportReplyEmail({
    reply: "Thanks for asking. This is a sample reply.\n\nA second paragraph, with <script>alert(1)</script> shown as text.",
    sources: [`${SAMPLE_ORIGIN}/docs/getting-started`, "javascript:alert(1)"],
    question: "Sample question: how do I connect my agent?",
  }),
  "lifecycle.run_finished": () => runFinishedEmail({
    agentName: "Sample agent", suiteLabel: "eu-support v5", status: "completed", outcome: "fail",
    passed: 40, failed: 6, noResult: 3, runUrl: `${SAMPLE_ORIGIN}/runs/00000000-0000-0000-0000-000000000000`, manageUrl: `${SAMPLE_ORIGIN}/settings/profile`,
  }),
  "lifecycle.report_ready": () => reportReadyEmail({
    agentName: "Sample agent", contentHash: "0".repeat(64),
    runUrl: `${SAMPLE_ORIGIN}/runs/00000000-0000-0000-0000-000000000000`, manageUrl: `${SAMPLE_ORIGIN}/settings/profile`,
  }),
  "lifecycle.trial_ending": () => trialEndingEmail({ runsUsed: 2, runsLimit: 3, settingsUrl: `${SAMPLE_ORIGIN}/settings/grading`, manageUrl: `${SAMPLE_ORIGIN}/settings/profile` }),
  "lifecycle.trial_used": () => trialUsedEmail({ runsUsed: 3, runsLimit: 3, settingsUrl: `${SAMPLE_ORIGIN}/settings/grading`, manageUrl: `${SAMPLE_ORIGIN}/settings/profile` }),
  "lifecycle.schedule_paused": () => schedulePausedEmail({
    agentName: "Sample agent", reason: "Sample reason: the workspace's model key could not be reached.",
    schedulesUrl: `${SAMPLE_ORIGIN}/agents`, manageUrl: `${SAMPLE_ORIGIN}/settings/profile`,
  }),
  "auth.confirm_signup": () => authTemplate("auth.confirm_signup"),
  "auth.reset_password": () => authTemplate("auth.reset_password"),
  "auth.change_email": () => authTemplate("auth.change_email"),
};

export const TEMPLATE_IDS = Object.keys(PREVIEWS) as TemplateId[];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as string[]).includes(value);
}
