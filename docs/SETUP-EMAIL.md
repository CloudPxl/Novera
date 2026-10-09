# Making signup email work

> **Superseded (2026-10-09)** by `docs/setup/email-checklist.md`, which is current. Do not follow
> step 7 below: Novera keeps Supabase's `{{ .ConfirmationURL }}` links, because a `token_hash` link
> signs in whichever browser opens it (launch-readiness row B). Kept for its history.

**Why this is needed:** Supabase Auth sends the confirmation email, not Novera. Supabase
has no mail sender configured, so today a new signup gets a "check your email" message
and no email ever arrives. Until this is done, accounts can only be created with the
admin API.

**Cost:** a domain, roughly €1–12 for the first year. Resend's free tier (3,000
emails/month) and Supabase's SMTP support are both free. This is the only thing in the
project that costs money.

**Time:** about 15 minutes of work, plus up to an hour of waiting for DNS.

---

## 1. Get a domain, if you do not have one

Any registrar works. Cloudflare and Porkbun are the cheapest that are not unpleasant.
Buy the domain you would actually want the product on — this is the same domain the
app will eventually be deployed at, and the same one the report links will use.

Write it down here when you have it: `________________________`

## 2. Add the domain to Resend

1. Sign in at https://resend.com (you already have an account — the API key slot in
   `.env.local` exists, it is just empty).
2. **Domains → Add Domain.**
3. Enter the domain. Choose the region **EU (Ireland)** — the rest of this product is
   EU-resident and there is no reason for the mail to be the exception.
4. Resend shows a table of DNS records: usually one `MX`, and two or three `TXT`
   (DKIM, SPF, and sometimes DMARC).

## 3. Put those records at your registrar

1. Open your registrar's DNS page for the domain.
2. Add each row Resend showed you, exactly as shown. The usual mistakes:
   - **Do not add your domain to the end of the Name/Host field.** Most registrars
     append it for you, so typing `send.yourdomain.com` becomes
     `send.yourdomain.com.yourdomain.com`. If Resend says `send`, type `send`.
   - Copy the **whole** TXT value including `p=...`; the DKIM one is long and easy to
     truncate.
3. Back in Resend, press **Verify**. It usually goes green in a few minutes; DNS can
   take up to an hour. Leave it and come back.

**Stop here until Resend shows the domain as Verified.** Nothing below works before that.

## 4. Create the SMTP credential in Resend

1. **API Keys → Create API Key.**
2. Name it `supabase-auth`. Permission: **Sending access**. Domain: the one you just
   verified.
3. Copy the key. It is shown once.
4. Paste it into `.local-credentials.md` in the project root — that file is gitignored.
   Do not paste it into a chat window.

## 5. Point Supabase at Resend

In the Supabase dashboard for the Novera project:

1. **Authentication → Emails → SMTP Settings** (older dashboards: *Project Settings →
   Auth → SMTP Settings*). Turn on **Enable Custom SMTP**.
2. Fill in exactly:

   | Field | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the API key from step 4 |
   | Sender email | `no-reply@yourdomain.com` |
   | Sender name | `Novera` |

   The username is the literal word `resend`, not your email address.
3. Save.

## 6. Tell Supabase where the app lives

**Authentication → URL Configuration:**

1. **Site URL:** `http://localhost:3000` for now. Change it to the real URL when we
   deploy.
2. **Redirect URLs:** add both, one per line:
   ```
   http://localhost:3000/**
   https://yourdomain.com/**
   ```

## 7. Repoint the confirmation email at Novera's own route

This step is easy to miss and signup will not work without it.

**Authentication → Emails → Templates → Confirm signup.** Replace the link in the
template body with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">
  Confirm your email address
</a>
```

Do the same for **Magic Link** (`type=magiclink`) and **Reset Password**
(`type=recovery`) if you want those to work later.

The default template points at Supabase's own verify endpoint, which does not create
the session the way `src/app/auth/confirm/route.ts` expects.

## 8. Tell me it is done

Reply with the domain and I will:
- create a throwaway account through the real signup form,
- confirm the email arrives and the link lands on the dashboard,
- confirm an expired and an already-used link are both refused with a readable message,
- then erase the throwaway workspace.

---

## If you would rather not buy a domain yet

Resend will send from `onboarding@resend.dev` without any domain, but **only to the
address that owns the Resend account** (davidrosu72@gmail.com). That is enough to build
and test the whole flow and nothing else — no other person can sign up. Tell me and I
will set it up that way; steps 1–3 are then skipped and step 5's sender becomes
`onboarding@resend.dev`.

---

# Status as of 2026-09-23 — done, with one DNS record left

**Signup is verified end to end in production.** A real `auth.signUp` returned no error
and set `confirmation_sent_at`, so Supabase's SMTP accepted the message. The confirmation
link redirected to `/dashboard`, set a session cookie and set `email_confirmed_at`. An
invalid token and a token with no type each redirect to `/sign-in` with the right
message. The test account was deleted afterwards.

The checklist above is therefore complete. What I could **not** check from here: the
Resend key in `.env.local` is send-only, so delivery logs are unreadable and inbox
*placement* is unproven. That is what the record below is for.

## The one thing still missing: a DMARC record

DNS as it stands (checked 2026-09-23):

| Record | State |
|---|---|
| `resend._domainkey.nover.space` | present — DKIM signs as `d=nover.space`, aligned with `From: no-reply@nover.space` |
| `send.nover.space` SPF | present — Resend's bounce domain, which is how Resend aligns SPF |
| `nover.space` SPF | `include:spf.efwd.registrar-servers.com ~all` — the registrar's forwarder, which is correct and unrelated |
| `_dmarc.nover.space` | **missing** |

DKIM alignment alone would satisfy DMARC, but with no policy published some receivers
apply their own default and others weight the absence against you. Add one TXT record:

```
Host:  _dmarc
Type:  TXT
Value: v=DMARC1; p=none; rua=mailto:dmarc@nover.space; fo=1
```

`p=none` on purpose: it publishes a policy and starts the reports without risking
legitimate mail — including anything sent through the registrar's forwarding path —
being quarantined before we have seen a single report. Once the reports show only
Resend signing for the domain, move to `p=quarantine`, then `p=reject`.

Verify with `dig +short TXT _dmarc.nover.space`.
