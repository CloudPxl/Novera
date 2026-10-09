# Error monitoring

Server errors are reported through `src/lib/observability/`, wired into Next's
`onRequestError` hook in `src/instrumentation.ts`. Every error Next captures on the server —
page render, route handler, server action, proxy — produces one event.

**Default: a console line only.** Each event is printed as one line starting
`[novera:error] {…}` (JSON). On Vercel that is the function log (Project → Logs, search
`novera:error`); locally it is the terminal. No vendor receives anything until one of the
variables below is set.

## What an event contains, and what it never contains

The event is built from an allow list (`scrubEvent`), never by copying the error:

| Kept | How |
|---|---|
| Error class name, Next's `digest` | as is (name validated as an identifier) |
| Message | scrubbed, at most 500 characters |
| Stack | the `at …` frames only, at most 12, scrubbed |
| Request method and path | path without query or fragment; `/report/<token>`, `/api/reports/<token>`, `/invite/<token>` become `[token]` |
| Headers | only `accept`, `content-type`, `content-length`, `x-vercel-id`, `rsc`, `next-router-prefetch`, and `next-action` as `[present]`; every other header is counted (`droppedHeaders`), not kept |
| Next context | router kind, route pattern, route type, render source |
| Environment, release | `VERCEL_ENV`, first 12 characters of `VERCEL_GIT_COMMIT_SHA` |

The scrubber removes, wherever they appear in a kept string: provider keys (`sk-…`, `gsk_…`,
Google), Novera's `nvk_` keys and `whsec_` secrets, Stripe `sk_live_`/`rk_` keys, `Bearer`
tokens, JWTs, emails, phone numbers, IBANs, card numbers, IP addresses, Supabase session
cookies, `cookie:` / `authorization:` / `x-api-key:` text, URL query strings and
`code=` / `token=` / `token_hash=` / `signature=` parameters, the row Postgres quotes in
`Failing row contains (…)` and the value in `Key (…)=(…)`, any quoted passage over 40
characters (how an agent's reply or a policy line ends up inside an error message), and any
remaining opaque run of 40+ characters.

Never included at all: request bodies, query strings, cookies, auth headers, `error.cause`,
any other property of the error, the user, the workspace, the server name.

What the scrubber cannot know: a short unquoted fragment of policy or agent text written
into an error message by our own code. Error messages in `src/` should name what failed,
not quote what it failed on.

## Proving it

```
npm test                                  # tests/observability.test.ts
npm run observability:test-event          # one synthetic error through the configured reporters
```

The test event carries a fake value of every shape above (built at run time; no real key is
in the repository) and exits 1 if any of the 12 planted values reached the event that left.
With a vendor configured, the same event is sent there: open the vendor and find
`Provider refused key [SECRET_1]`.

Measured 2026-10-09 (worktree, local): `npm run observability:test-event` exit 0, console
only; with `NOVERA_ERROR_WEBHOOK_URL` pointing at a local receiver, the receiver got the
1,338-byte scrubbed event with `Authorization: Bearer <token>`. Through a real `next dev`
server, a temporary route throwing `"boom with key sk_live_… and mail a.b@c.eu"` (called with
a session cookie, a `Bearer nvk_…` header and `?token=`) produced
`"message":"boom with key [SECRET_1] and mail [EMAIL_1]"`, path `/api/zz-boom`, one header
kept, eight dropped.

**Known limit:** Next itself still prints the raw error (`⨯ Error: …`) to the function log,
before and independently of this hook. That line is Vercel's log, readable by the project's
members only; it is not sent anywhere else. The `[novera:error]` event is what goes to a
vendor. Keeping secrets out of thrown messages in the first place is still the rule.

## Configuration

All optional. Set in Vercel → Project → Settings → Environment Variables (Production, and
Preview if wanted), then redeploy.

| Variable | Effect |
|---|---|
| `NOVERA_ERROR_REPORTING=off` | Nothing is reported, not even the console line |
| `NOVERA_ERROR_SENTRY_DSN` | Also send each event to Sentry (or a Sentry-compatible collector such as GlitchTip) through its HTTP envelope endpoint. No SDK is installed |
| `NOVERA_ERROR_WEBHOOK_URL` | Also `POST` each event as JSON to this `https://` address |
| `NOVERA_ERROR_WEBHOOK_TOKEN` | Sent to that webhook as `Authorization: Bearer …` |

Vendor calls are server-side only, through the same public-address guard as every other
outbound request, with a 3-second deadline, no redirects followed, and at most 30 per minute
per function instance. The browser never talks to a vendor, so `src/proxy.ts`'s CSP is
unchanged. Browser-side errors (`error.tsx`, `global-error.tsx`) are not reported; adding
that would mean a browser-to-vendor call and a CSP `connect-src` entry, a separate decision.

### If choosing Sentry (David)

1. Create the project in Sentry's **EU region** (data stored in Frankfurt): organisation
   region "European Union" at sign-up. The DSN then ends in `.de.sentry.io/<id>`.
2. Project → Settings → Security & Privacy: switch on **Prevent Storing of IP Addresses**
   and **Data Scrubber** (defence in depth; our events already arrive scrubbed).
3. Copy the DSN (Settings → Client Keys) into `NOVERA_ERROR_SENTRY_DSN`. The DSN's key is a
   public ingestion key, but keep it server-side: it is not a `NEXT_PUBLIC_` variable.
4. Redeploy, then run `npm run observability:test-event` locally with the same variable and
   check the event in Sentry.
5. Add Sentry to the sub-processor list (legal work item L1) before relying on it.

Any other vendor with an HTTPS JSON ingest (Better Stack, Axiom, a log drain, an n8n
webhook) works through `NOVERA_ERROR_WEBHOOK_URL`.

Status: **not configured in production.** Only the console line is active after deploy.
