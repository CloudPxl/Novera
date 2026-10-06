# Sign-in and email: what is configured outside the repository

The code for email confirmation, password reset, Google, GitHub and identity linking is in the
repository (2026-10-06). Five settings live in dashboards and cannot be made from here. Until
step 2 is done, **new email accounts cannot be confirmed in production**: Supabase's built-in
mailer sends only to the project's own team addresses, a few an hour.

No secret below goes into the repository, a commit, a chat or a log. Values are typed into the
dashboard field named.

## 1. Resend: the sending domain

State on 2026-10-06, read from public DNS via 1.1.1.1:

| Record | Name | Found |
|---|---|---|
| DKIM | `resend._domainkey.nover.space` | present |
| SPF | `send.nover.space` (TXT) | present |
| Bounce MX | `send.nover.space` (MX) | present |
| DMARC | `_dmarc.nover.space` | **missing** |

1. Resend → **Domains** → `nover.space`: confirm the status reads **Verified**. If not, press
   **Verify DNS records** and wait for it.
2. At the DNS host for `nover.space` (Namecheap, `registrar-servers.com`), add a TXT record:
   - Host: `_dmarc`
   - Value: `v=DMARC1; p=none; rua=mailto:<an address you read>; adkim=s; aspf=s`

   `p=none` only reports; move to `p=quarantine` after a couple of weeks of clean reports.
3. Resend → **API Keys** → create a key named `supabase-smtp`, permission **Sending access**,
   domain `nover.space`. Keep it on screen for step 2; it is shown once.

## 2. Supabase: custom SMTP

Supabase → project → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `no-reply@nover.space` (any address at the verified domain) |
| Sender name | `Novera` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the `supabase-smtp` key from step 1.3 |

Then **Authentication → Rate Limits → Rate limit for sending emails**: raise it from 2 to
`30` an hour. The application also limits each address: five sign-ups, three resends and three
resets an hour.

## 3. Supabase: addresses

**Authentication → URL Configuration**:

- **Site URL:** `https://www.nover.space`
- **Redirect URLs:** add exactly these two, and nothing broader:
  - `https://www.nover.space/auth/callback**`
  - `http://localhost:3000/auth/callback**` (local development only; remove it if you never run locally)

The application sends every emailed and provider link back to `/auth/callback` with a `flow`
parameter. A return address not on this list makes Supabase fall back to the Site URL root;
the app forwards a code arriving there, but put the address on the list anyway.

**Templates are optional.** The default templates work: their link goes through Supabase and
back to `/auth/callback` with a one-time code. Opening it in the browser that asked for it signs
the person in; opening it elsewhere confirms the address and asks them to sign in by hand.

If you want links that sign in on any device, change the templates under **Authentication →
Emails → Templates**. Leave everything else in each template as it is:

- **Confirm signup:** `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
- **Reset password:** `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
- **Change email address:** `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change`
- **Invite user:** not used. Novera sends its own invitation emails.

Keep **Confirm email** and **Secure email change** switched on (Authentication → Sign In /
Providers → Email).

## 4. Google

1. Google Cloud console → a project named `Novera` → **APIs & Services → OAuth consent
   screen**:
   - User type: External; app name `Novera`; support email: yours.
   - Authorised domain: `nover.space`.
   - Scopes: `openid`, `email` and `profile` only.
   - Publish the app, so it is not limited to test users.
2. **Credentials → Create credentials → OAuth client ID** → *Web application*:
   - Authorised JavaScript origins: `https://www.nover.space`
   - Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. The
     project ref is the first part of the Supabase project URL, under Project Settings → API.
3. Supabase → **Authentication → Sign In / Providers → Google** → enable. Paste the client ID
   and the client secret.

## 5. GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:
   - Application name: `Novera`
   - Homepage URL: `https://www.nover.space`
   - Authorization callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`
2. **Generate a new client secret**.
3. Supabase → **Authentication → Sign In / Providers → GitHub** → enable. Paste the client ID
   and the secret.

## 6. Identity linking

Supabase → **Authentication → Sign In / Providers** → enable **Allow manual linking**. Without
it, **Connect Google / GitHub** under Settings → Sign-in and security refuses with a sentence
saying so. Signing in with a provider whose verified address matches an existing account opens
that account either way; that is Supabase's automatic linking and needs no setting.

## What appears when

- The **Continue with Google** and **Continue with GitHub** buttons appear on their own, within
  five minutes of a provider being enabled. The app reads Supabase's public settings and shows
  only enabled providers, so there is nothing to deploy.
- No restart or redeploy is needed for any step above. None of them changes an environment
  variable.

## Proving it in production

After steps 1–3, with an address you control:

1. Create an account at `https://www.nover.space/sign-in?mode=signup`. The page says **Check
   your inbox**.
2. Check the logs:
   - Resend → **Logs**: one message to that address, status *Delivered*.
   - Supabase → **Logs → Auth**: a `user_confirmation_requested` line.
3. Open the link in the same browser. You land on the three onboarding questions, then the
   dashboard.
4. Sign out, choose **Forgotten your password?**, use the emailed link, and set a new password.
   You land on the dashboard. Sign in with it.
5. Sign up again with the same address. The page reads the same, and Resend shows no second
   message.
6. After steps 4–6, choose **Continue with GitHub** on the sign-in page. Then, under Settings →
   Sign-in and security, connect and disconnect Google.

The confirmation link and the code it carries are single-use. Do not paste one into a chat or
a ticket.
