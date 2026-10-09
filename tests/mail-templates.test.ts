import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_TEMPLATE_FILE, AUTH_TEMPLATE_IDS, LIFECYCLE_EVENTS, PREVIEWS, TEMPLATE_IDS, TEMPLATE_VERSION,
  authTemplate, escapeHtml, invitationEmail, lifecycleEmailsEnabled, reportReadyEmail, safeUrl, supportReplyEmail,
} from "../src/lib/mail/templates.ts";
import { invitationMailLine, mailDiagnostics } from "../src/lib/mail/diagnostics.ts";
import { withSources } from "../src/lib/support/escalate.ts";

test("every variable is escaped in the HTML part, and a subject stays on one line", () => {
  const m = invitationEmail({
    inviterName: `Eve <img src=x onerror="alert(1)">`, workspaceName: `Acme\n<script>alert(1)</script>`, roleLabel: "Reviewer",
    link: "https://www.nover.space/invite/abc", email: "a@example.com",
  });
  assert.ok(!m.html.includes("<script>alert(1)</script>"));
  assert.ok(!m.html.includes("<img"));
  assert.ok(m.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.match(m.subject, /^You are invited to Acme <script>/); // plain text: a subject is not markup
  assert.ok(m.html.includes('href="https://www.nover.space/invite/abc"'));
  assert.equal(escapeHtml(`"'&<>`), "&quot;&#39;&amp;&lt;&gt;");
});

test("only an absolute http(s) address becomes a link", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("/docs/x"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  const reply = supportReplyEmail({ reply: "Hi", sources: ["javascript:alert(1)", "https://www.nover.space/docs/a"], question: "Q" });
  assert.ok(!reply.html.includes('href="javascript:'));
  assert.ok(reply.html.includes('href="https://www.nover.space/docs/a"'));
  const invite = invitationEmail({ inviterName: "A", workspaceName: "W", roleLabel: "Admin", link: "javascript:alert(1)", email: "a@b.co" });
  assert.ok(!invite.html.includes("href="));
});

test("the support reply's text part is the wording sendDraft sent before templates", () => {
  const body = "Three runs, then bring your own key.";
  const legacy = `${withSources(body, ["trial"], "https://www.nover.space")}\n\n— Novera\n\n\nYou asked:\n${"x".repeat(600)}`;
  const m = supportReplyEmail({ reply: body, sources: ["https://www.nover.space/docs/trial"], question: "x".repeat(900) });
  assert.equal(m.text, legacy);
  assert.equal(m.subject, "Re: your question about Novera");
});

test("every template renders from its sample data, with its version", () => {
  assert.equal(TEMPLATE_IDS.length, Object.keys(TEMPLATE_VERSION).length);
  for (const id of TEMPLATE_IDS) {
    const m = PREVIEWS[id]();
    assert.equal(m.template, id);
    assert.equal(m.version, TEMPLATE_VERSION[id]);
    assert.ok(m.subject.length > 0 && m.html.startsWith("<!doctype html>"), id);
    assert.ok(!/<script/i.test(m.html), `${id} carries no script`);
  }
});

test("the Supabase templates keep the default {{ .ConfirmationURL }} flow and match the files in docs", () => {
  for (const id of AUTH_TEMPLATE_IDS) {
    const html = authTemplate(id).html;
    assert.ok(html.includes('href="{{ .ConfirmationURL }}"'), id);
    assert.ok(!/token_?hash/i.test(html), `${id} must not use token_hash links`);
    const file = readFileSync(join("docs/setup/email-templates", AUTH_TEMPLATE_FILE[id]), "utf8");
    assert.equal(file, html, `${AUTH_TEMPLATE_FILE[id]} is stale: regenerate it from src/lib/mail/templates.ts`);
  }
  assert.ok(authTemplate("auth.change_email").html.includes("{{ .NewEmail }}"));
});

test("lifecycle email is off unless switched on, and nothing in the app sends it", () => {
  assert.equal(lifecycleEmailsEnabled({}), false);
  assert.equal(lifecycleEmailsEnabled({ NOVERA_LIFECYCLE_EMAILS: "true" }), false);
  assert.equal(lifecycleEmailsEnabled({ NOVERA_LIFECYCLE_EMAILS: "on" }), true);
  for (const [event, e] of Object.entries(LIFECYCLE_EVENTS)) {
    const m = PREVIEWS[e.template]();
    assert.match(m.text, /Stop these emails at any time/, event);
    assert.match(m.html, /Stop these emails at any time/, event);
  }
  assert.equal(LIFECYCLE_EVENTS["trial.ending"].basis, "consent");
  assert.equal(LIFECYCLE_EVENTS["trial.used"].basis, "consent");
  // A report link is a bearer token; the report email links to the run page behind sign-in.
  const report = reportReadyEmail({ agentName: "A", contentHash: "f".repeat(64), runUrl: "https://www.nover.space/runs/1", manageUrl: "https://www.nover.space/settings/profile" });
  assert.ok(!report.text.includes("/report/"));

  const lifecycleNames = /\b(runFinishedEmail|reportReadyEmail|trialEndingEmail|trialUsedEmail|schedulePausedEmail|lifecycleEmailsEnabled)\(/;
  const callers: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !path.startsWith(join("src", "lib", "mail")) && lifecycleNames.test(readFileSync(path, "utf8"))) callers.push(path);
    }
  };
  walk("src");
  assert.deepEqual(callers, [], "a lifecycle email is called from the app; it needs David's approval first");
  // The preview page renders; it must not be able to send.
  assert.ok(!readFileSync("src/app/(app)/inbox/email/preview/page.tsx", "utf8").includes("mail/send"));
});

test("mail diagnostics report presence and shape, never a secret", () => {
  const secret = "re_SECRETSECRETSECRET123";
  const d = mailDiagnostics({ RESEND_API_KEY: secret, RESEND_FROM_EMAIL: "no-reply@nover.space", NEXT_PUBLIC_APP_URL: "https://www.nover.space", VERCEL_ENV: "production" });
  assert.equal(JSON.stringify(d).includes("SECRET"), false);
  assert.deepEqual(d.resendKey, { present: true, shape: "re_" });
  assert.equal(d.from.domain, "nover.space");
  assert.equal(d.appUrlIsCanonical, true);
  assert.deepEqual(d.problems, []);
  assert.equal(d.configured, true);
  assert.ok(d.unreadable.some((u) => /Supabase/.test(u)));
  assert.equal(invitationMailLine(d), null);

  const empty = mailDiagnostics({});
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.resendKey, { present: false, shape: null });
  assert.match(invitationMailLine(empty)!, /cannot send email yet/);

  const wrong = mailDiagnostics({ RESEND_API_KEY: "sk_live_abc", RESEND_FROM_EMAIL: "Novera <hi@gmail.com>", NEXT_PUBLIC_APP_URL: "http://nover.vercel.app", VERCEL_ENV: "production" });
  assert.equal(wrong.resendKey.shape, "unexpected");
  assert.equal(wrong.from.wellFormed, false);
  assert.ok(wrong.problems.some((p) => /re_/.test(p)));
  assert.ok(wrong.problems.some((p) => /production links must use/.test(p)));
  assert.equal(JSON.stringify(wrong).includes("sk_live_abc"), false);
  assert.match(invitationMailLine(wrong)!, /incomplete/);
});
