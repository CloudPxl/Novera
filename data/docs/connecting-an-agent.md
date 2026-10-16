---
title: Connecting an agent
published: true
---
Novera talks to your agent over HTTP. You give it the endpoint URL, a JSON request body template containing `{{input}}` where the scenario text should go, and the path to the reply text in the response.

If your agent also receives data *about* a conversation — account fields, a profile, a CRM note — put `{{context}}` in the template where that data belongs. Some scenarios attack that channel, because real prompt injections arrive there rather than in something a customer typed. If there is nowhere to put it, those scenarios are reported as not run rather than sent to your agent as an ordinary message, which would be a different test.

You can also give Novera a read-only endpoint in your own systems. A scenario that expects something to change then says what must be true there, and Novera checks it independently of what your agent claims. It is GET-only by construction, a scenario cannot point it anywhere but the host you configured, the credential is separate from your agent's, and the response body is never stored.

Your agent has 30 seconds to answer each message — less if you set a shorter timeout — and that includes the whole reply arriving, not only its first byte. A reply that takes longer is recorded as no answer for that scenario, never as a pass. Novera reads at most 256 KB of a reply; a longer one is not read, and that scenario is recorded as no answer with the reason, while the rest of the run carries on. The read-only endpoint has the same 256 KB limit, and an answer past it counts as unavailable. Novera only calls addresses on the public internet: an endpoint whose name resolves to a private or internal address is refused, and so is a redirect, which is reported rather than followed. The same holds for the read-only endpoint.

If your endpoint needs an auth header, you name the header and paste the value. The value is encrypted before storage and only ever decrypted on the server.

Before any suite run, Novera sends one harmless request and saves the reply as a receipt. Read that receipt before trusting a full run: it is how you confirm you are testing the thing you think you are testing.

## Testing before you save

**Test connection**, beside the endpoint fields on the connect form and under **Change the connection**, sends one message — "Hello, this is a connection check from Novera. Please reply briefly." — from what is in the form now, before anything is saved. It uses the same request template, auth header and public-address check a run uses, and waits at most 10 seconds. Nothing is stored: no agent, no receipt. The form keeps what you typed, credential included.

The result says one of these:

- **Connected** — the HTTP status, how long the round trip took, and the first 200 characters of the reply Novera read at your reply path.
- **Could not reach the endpoint within 10 s** — the name did not resolve, no connection could be made, or nothing came back in time.
- **Not a public address** — the name resolves to a private, loopback or internal address, so nothing was sent.
- **HTTP 401 or 403** — the endpoint refused the request; check the header name and the credential.
- **Another HTTP status**, or a **redirect**, which Novera does not follow.
- **No reply text at the reply path** — the endpoint answered, but not where the reply path points. The result lists the reply's top-level keys (names only, never their values) and, when it can tell, where the reply appears to be, with a button that puts that path in the form so you can test again.

On an agent you already saved, leaving the credential empty tests with the stored one — but only while the address stays on the same host. A stored credential never follows its address to another host: paste it again for the new host, or tick **Remove the stored credential**. The owner, an admin or an operator can test; a workspace can make 20 tests in ten minutes. The same test is `POST /api/v1/agents/test-connection` (see **The Novera API**).

## Trying the sample agent first

Where this deployment offers it, **Or try a sample support agent first** — on the getting-started steps and on the connect page — adds **Sample support agent (Novera test fixture)**: Novera's own scripted agent, with failures planted on purpose, and a stand-in system of record, so a claimed refund that never happened shows up as contradicted. It comes with a sample policy, so the next step is a run.

It is never presented as a real agent. Its name says what it is, it carries a **Test fixture** badge, and every run against it — on screen and on its sealed report — is labelled test data, not a real agent or a real customer interaction. It is a test target, because nothing it does happens anywhere. Pressing the button again opens the one you already have. A run against it is counted like any run: on the trial, it is one of your three.

You must own the agent you connect, or be authorised to test it. That confirmation is recorded and copied onto every run, so a report can always say on whose authority the test was performed.

## Changing or archiving an agent

Open the agent and go to its **Connection** tab. Under **Change the connection** you can change its name, endpoint URL, request body template, reply path, tool activity path, timeout, and the auth header and credential. The owner, an admin or an operator can do this; a reviewer or an auditor cannot.

- The request body must stay a JSON object with `{{input}}` in it. It may also use `{{policy}}`, `{{context}}`, `{{history}}` and `{{conversation_id}}`. Any other placeholder is refused, because Novera would send it to your agent as written.
- The timeout is a whole number of seconds from 2 to 30. Leave it empty for the longest wait, 30 seconds.
- A stored credential is never shown, not even to you. The form says only whether one is stored. Paste a new value to replace it (the old one is removed once the new one is stored), or tick **Remove the stored credential**. A stored credential needs a header name to be sent in.
- When you save, Novera checks the new address is public and saves the change. Then it sends one harmless request and replaces the receipt, so you can see the new connection works before a run relies on it.
- You cannot change the connection while a run of this agent is queued or running. That run recorded the connection it uses before it started, so wait for it to finish or stop it. You can still rename the agent.
- Runs and reports you already have do not change. Each run recorded its endpoint host and a fingerprint of its request configuration before it started, and a sealed report keeps its own copy of everything it states, including the agent's name. The change applies from the next run.
- The audit log records who changed the connection and which fields changed. It never records the values.

**Archiving** takes an agent out of the way without losing anything. Only the owner or an admin can archive an agent, and you confirm by typing its name. An archived agent:

- is hidden from the agents list, the run launcher, the assistant and the API's agent list. Open **Archived** on the agents page to see it.
- cannot start a new run, retest or schedule, from the app, the API, an assistant or a schedule. Any of these is refused with a sentence that says why.
- keeps every run, report, receipt and piece of evidence. They stay readable, and report links keep working. Withdrawing a report is a separate decision.
- has its active schedules paused, not cancelled, with the reason shown. After you restore the agent they stay paused until you resume them.

You cannot archive an agent while a run of it is queued or running. **Restore** on the same tab brings the agent back. Both archiving and restoring appear in the audit log. Novera never deletes an agent on its own: its runs and reports refer to it. The only way to remove it is to erase the whole workspace.
