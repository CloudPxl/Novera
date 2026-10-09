# Email: the production checklist

Every email Novera relies on, and the exact dashboard steps that make it leave. Until steps 1–4
are done, **production sends no email**: no sign-up confirmation, no password reset, no
invitation, no support reply (audit 2026-10-08, `docs/setup/sign-in-and-email.md`).

Two senders, one domain:

| Email | Sent by | Through |
|---|---|---|
| Sign-up confirmation, password reset, email change | Supabase Auth | Supabase custom SMTP → Resend |
| Workspace invitation, approved support reply | Novera (`src/lib/mail/send.ts`) | Resend HTTP API |
| Lifecycle notices (run finished, report sealed, trial, schedule paused) | Nobody yet | Templates only; off (step 7) |

No secret goes into the repository, a commit, a chat or a log. Each value is typed into the
dashboard field named.

You can check what this server sees at any time, without exposing a secret: sign in as staff and
open **/inbox/email**. It reports whether `RESEND_API_KEY` is present and has the `re_` shape (never
its value), the domain of `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL` against the canonical host, and
it says plainly what it cannot read: Resend's domain status and Supabase's SMTP settings.

## 1. Resend: verify the domain

1. Resend → **Domains** → `nover.space`. The status must read **Verified**. If it does not, press
   **Verify DNS records**; if a record shows as failing, copy Resend's exact value into Namecheap
   (the DNS host for `nover.space`).
2. Resend → **API Keys** → **Create API Key**: name `novera-production`, permission **Sending
   access**, domain `nover.space`. It is shown once. Use the same key in steps 2 and 3 (or create a
   second one named `supabase-smtp` for step 3, so each can be revoked alone).

## 2. Vercel: the sending variables

Vercel → Project → **Settings → Environment Variables**, environment **Production**:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | the key from step 1.2 (starts with `re_`) |
| `RESEND_FROM_EMAIL` | `no-reply@nover.space` (the bare address; Novera adds the name "Novera") |
| `NEXT_PUBLIC_APP_URL` | `https://www.nover.space` (check it is already set) |

Then **Deployments → the latest production deployment → Redeploy**. Vercel applies a variable only
to new deployments. Afterwards **/inbox/email** shows the key as "present, re_ shape" and the
sender "at nover.space", with no problems listed.

Do not set `NOVERA_LIFECYCLE_EMAILS` (step 7).

## 3. Supabase: custom SMTP

Supabase → project → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `no-reply@nover.space` |
| Sender name | `Novera` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (the literal word) |
| Password | the Resend key from step 1.2 |

Save. Then **Authentication → Rate Limits → Rate limit for sending emails**: `30` per hour. The
application also limits each address: five sign-ups, three resends and three resets an hour.

## 4. DNS: DMARC

At Namecheap, a TXT record:

- Host: `_dmarc`
- Value, exactly: `v=DMARC1; p=none; rua=mailto:dmarc@nover.space; adkim=s; aspf=r`

No angle brackets. `aspf=r` is required because Resend sends from `send.nover.space`; DMARC passes
on DKIM, which Resend signs as `nover.space`. Move to `p=quarantine` after a couple of weeks of
clean reports. Check with `dig +short TXT _dmarc.nover.space`.

## 5. Supabase: the auth templates (optional but recommended)

Supabase → **Authentication → Emails → Templates**. For each template, set the subject and paste
the whole file as the body:

| Template | Subject | Body file |
|---|---|---|
| Confirm signup | `Confirm your Novera account` | `docs/setup/email-templates/confirm-signup.html` |
| Reset password | `Reset your Novera password` | `docs/setup/email-templates/reset-password.html` |
| Change email address | `Confirm your new Novera email address` | `docs/setup/email-templates/change-email.html` |

Each link is Supabase's own `{{ .ConfirmationURL }}`: the default flow, which returns to
`/auth/callback` with a one-time code. **Do not** replace it with a `token_hash` link to
`/auth/confirm`: such a link signs in whichever browser opens it (launch-readiness row B). The
files are generated from `src/lib/mail/templates.ts`, and `tests/mail-templates.test.ts` fails if
they drift; edit the source, then regenerate them, never the other way round.

"Invite user" and "Magic link" are not used: Novera sends its own invitations.

## 6. Production acceptance test

Only after steps 1–4. Use an address you control, plus Resend's test inbox
`delivered@resend.dev` (it accepts and discards; nothing reaches a person).

1. **Sign-up.** Open `https://www.nover.space/sign-in?mode=signup` in a private window and create an
   account with your own address. The page says *Check your inbox*. Resend → **Logs** shows one
   message, *Delivered*; Supabase → **Logs → Auth** shows `user_confirmation_requested`. Open the
   link in the same browser: you land on onboarding.
2. **Reset.** Sign out, choose **Forgotten your password?**, open the emailed link, set a new
   password, sign in with it.
3. **Invitation.** Settings → Members → invite `delivered@resend.dev` as Auditor. The answer starts
   **Invitation sent**. Resend → Logs shows it *Delivered*. Revoke the invitation afterwards.
4. **Support reply.** Send a question through `https://www.nover.space/support` from an address you
   control. In **/inbox**, approve the draft, then press **Send to …**. The draft moves to *sent* and
   the message arrives. If it fails, the draft stays *approved* with the error shown and the button
   reads **Try sending again to …**.
5. Record the date and the Resend message ids in the launch-readiness row A1.

Local development never uses Resend: leave `RESEND_API_KEY` empty in `.env.local`. Local auth mail
goes to Supabase's own catcher (Mailpit/Inbucket) at `http://127.0.0.1:54324`.

## 7. Lifecycle emails: off until approved

`src/lib/mail/templates.ts` holds templates for five events, mapped in `LIFECYCLE_EVENTS`:

| Event | Template | Basis |
|---|---|---|
| `run.completed` | `lifecycle.run_finished` | service notice: sent unless the person opted out |
| `report.sealed` | `lifecycle.report_ready` | service notice: sent unless the person opted out |
| `schedule.paused` | `lifecycle.schedule_paused` | service notice: sent unless the person opted out |
| `trial.ending` | `lifecycle.trial_ending` | needs opt-in consent; default no |
| `trial.used` | `lifecycle.trial_used` | needs opt-in consent; default no |

**Nothing sends them.** No code calls a sender for any lifecycle event, and
`lifecycleEmailsEnabled()` is false unless `NOVERA_LIFECYCLE_EMAILS=on`. Switching it on requires
David's explicit approval, and only after:

1. steps 1–6 pass in production;
2. a per-person preference exists (Settings → Profile; stored in `user_profiles.notifications`),
   with service notices defaulting on with a one-click opt-out, and the two trial notices defaulting
   off until the person opts in;
3. every lifecycle email carries its opt-out link (the templates already end with one) and the
   privacy notice lists these emails;
4. a sender is written that reads the preference, counts from stored rows, and never includes a
   report's link (a bearer token) — the report-sealed template links to the run page, behind sign-in.

Previews of every template, with sample data, are at **/inbox/email/preview** (staff only in
production). That page cannot send.
