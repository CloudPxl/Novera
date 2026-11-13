---
title: Connecting an agent
published: true
---
Novera talks to your agent over HTTP. You give it the endpoint URL, a JSON request body template containing `{{input}}` where the scenario text should go, and the path to the reply text in the response.

## Starting from a platform or a curl command

You do not have to write the request yourself. On the connect page, **Start from** fills the form for a platform Novera knows:

- **Dify** (chat, agent or chatflow app): the chat-messages API. Novera asks for a streamed answer, which every Dify app type supports, and uses the conversation id Dify issues. If you paste Dify's API base (`…/v1`), `/v1/chat-messages` is added and the form says so.
- **OpenAI-compatible chat completions** and **Anthropic-compatible messages**: the conversation travels as `{{messages}}`, the whole chat list ending with the scenario's message. Replace `your-model` with the name your endpoint expects.
- **Flowise**, **n8n chat trigger**, **Langflow**: each scenario gets its own session id.
- **Voiceflow**: the reply is every text message of the answer, one per line (`*.payload.message`), and each scenario is its own user in the address.
- **Custom JSON endpoint**: one field with the message, one field of the reply.

A starting point only fills fields you can read and change. It is the connection check, not the starting point, that shows the endpoint answers. Platforms that need several requests for one message (Botpress's Chat API) or whose input is defined by your own application (LangServe, LangGraph) have no starting point; use the curl import or the custom format.

**Paste a curl command** reads a command from your platform's API documentation into the form: the address, the headers and the request body, with the message field turned into `{{input}}` (or a chat list into `{{messages}}`) and a session or conversation id into `{{conversation_id}}`. The command is read in your browser. It is never run and never sent to Novera; a credential in it goes into the credential field, which is stored encrypted. The form lists what it read and what you still have to check.

A bare API token pasted under `authorization` (one beginning `app-`, `sk-` and the like) is sent as `Bearer` followed by the token, and the connection check says so. Anything that already names a scheme, and any other header, is sent as pasted. Headers that are not secret go under **Other headers**, one per line; a header that carries a key is refused there and belongs under Authentication.

## How the reply is read

- **JSON**: the text at the reply path, such as `reply` or `choices.0.message.content`. A `*` stands for every element of a list.
- **A stream of server-sent events**: read to its end and put back together in order, from the stream path (or the reply path). If the stream replaces what it sent (an output filter), the reply is the replacement; if it ends in an error, there is no reply.
- **Plain text**: set the reply path to `$text` and the whole body is the reply.

The path is chosen when you connect and stored. It is never guessed again during a run.

## Metadata and conversations

If your agent also receives data *about* a conversation — account fields, a profile, a CRM note — put `{{context}}` in the template where that data belongs. Some scenarios deliver content there (a retrieved document, a tool's result), because real prompt injections arrive that way rather than in something a customer typed. A conversation scenario needs `{{messages}}`, `{{history}}` or `{{conversation_id}}`.

When the request has no such field, **Deliver metadata and earlier turns in the message** decides what happens. Ticked (the default for a new agent), the content is sent as a labelled block at the top of the message — the scenario's own key and its text, with nothing added that tells the agent how to treat it — and the run declares, before it starts, which scenarios arrive that way. The report names them and says what that means: a failure is a failure either way; a pass shows the agent handled that content correctly inside a message, and does not show how it treats the same content arriving through its own retrieval, tools or conversation memory. Unticked, those scenarios are not sent and the report lists them as not run. An agent connected before 12 November 2026 has it unticked until you change it under **Change the connection**.

You can also give Novera a read-only endpoint in your own systems. A scenario that expects something to change then says what must be true there, and Novera checks it independently of what your agent claims. It is GET-only by construction, a scenario cannot point it anywhere but the host you configured, the credential is separate from your agent's, and the response body is never stored. A 404 from it is reported as unable to verify unless you tick **A 404 from this system means the record does not exist** — only for a system that answers 404 for a missing record and never for a wrong address. With it ticked, an agent that claims to have acted on a record your system does not have fails that scenario, without a model being asked.

Your agent has 30 seconds to answer each message — less if you set a shorter timeout — and that includes the whole reply arriving, not only its first byte. A reply that takes longer is recorded as no answer for that scenario, never as a pass. Novera reads at most 256 KB of a reply; a longer one is not read, and that scenario is recorded as no answer with the reason, while the rest of the run carries on. The read-only endpoint has the same 256 KB limit, and an answer past it counts as unavailable. Novera only calls addresses on the public internet: an endpoint whose name resolves to a private or internal address is refused, and so is a redirect, which is reported rather than followed. The same holds for the read-only endpoint.

If your endpoint needs an auth header, you name the header and paste the value. The value is encrypted before storage and only ever decrypted on the server.

Before any suite run, Novera sends one harmless request and saves the reply as a receipt. Read that receipt before trusting a full run: it is how you confirm you are testing the thing you think you are testing.

## Testing before you save

**Verify the connection** on the connect form (**Test connection** under **Change the connection**) sends one message — "Hello, this is a connection check from Novera. Please reply briefly." — from what is in the form now, before anything is saved. It uses the same request template, auth header and public-address check a run uses, and waits at most 10 seconds. Nothing is stored: no agent, no receipt. The form keeps what you typed, credential included.

The result says one of these:

- **Connected** — the HTTP status, how long the round trip took, and the first 200 characters of the reply Novera read at your reply path.
- **Could not reach the endpoint within 10 s** — the name did not resolve, no connection could be made, or nothing came back in time.
- **Not a public address** — the name resolves to a private, loopback or internal address, so nothing was sent.
- **HTTP 401 or 403** — the endpoint refused the request; check the header name and the credential.
- **Another HTTP status**, or a **redirect**, which Novera does not follow: the error names where it points, so the fix is to enter that address. Three redirects in a row stop the run, as an unreachable endpoint does, and nothing is sealed; a CI gate reads that as a configuration problem (exit 3).
- **No reply text at the reply path** — the endpoint answered, but not where the reply path points. The result lists the reply's top-level keys and, when it can tell, where the reply appears to be, with a button that puts that path in the form so you can test again.
- **The reply was empty**, **not JSON** (with `$text` offered when it is plain text), or **a stream with no text in it** (the result lists the kinds of event the stream carried, so you can see where the text is).
- **The endpoint is limiting requests**: the platform answered HTTP 429, or said inside its answer that a rate, quota or concurrency limit was reached. Its words are quoted. In a run, Novera waits and sends again, then slows to one message at a time.
- **The answer was an error** or **the stream ended in an error**: the platform answered with an error instead of a reply, often its own configuration (a missing input variable, a failed step, a model or key it could not use). Its words are quoted.
- **A web page answered, not the agent**: a sign-in page, a firewall or a bot check answered at the address. Check the address and its access rules.
- **The agent's answer was empty**: a stream finished normally without any text. On a workflow platform, the path the message took ends without an answer step.
- **A stream that repeats the whole reply in every event**: set **Stream reading** to "whole text" and test again.

Novera reads JSON, server-sent event streams, JSON lines and the AI SDK's text stream. A reply at the reply path that is structured data rather than text (a workflow's decision object, say) is read as its JSON and graded as that. A list's last item is `-1`, as in `messages.-1.content`.

**Input variables** (under the advanced fields) adds named values to the request body's `inputs`, for an agent that expects them beside the message, such as a Dify app's Start-node variables. **Stream reading**, **Gap between messages** and **Send one scenario at a time** say how a run should treat a platform with its own limits. A key in the address's query string (`?code=`, `?api_key=`, `?token=`) is refused: put it under Authentication, where it is encrypted.

Under every result, **What was sent and what came back** shows the exchange: the method and address (without its query string), the headers (the credential by its header name only), the request body exactly as built, the status and time, the content type, how the answer was read, and where the reply was found. When the reply was not found, it lists the text fields of the answer with the start of each, and a button beside each to use it as the reply path. It also says how this connection carries conversations and metadata. None of it is stored.

On an agent you already saved, leaving the credential empty tests with the stored one — but only while the address stays on the same host. A stored credential never follows its address to another host: paste it again for the new host, or tick **Remove the stored credential**. The owner, an admin or an operator can test; a workspace can make 20 tests in ten minutes. The same test is `POST /api/v1/agents/test-connection` (see **The Novera API**).

## Trying the sample agent first

Where this deployment offers it, **Or try a sample support agent first** — on the getting-started steps and on the connect page — adds **Sample support agent (Novera test fixture)**: Novera's own scripted agent, with failures planted on purpose, and a stand-in system of record, so a claimed refund that never happened shows up as contradicted. It comes with a sample policy, so the next step is a run.

It is never presented as a real agent. Its name says what it is, it carries a **Test fixture** badge, and every run against it — on screen and on its sealed report — is labelled test data, not a real agent or a real customer interaction. It is a test target, because nothing it does happens anywhere. Pressing the button again opens the one you already have. A run against it is counted like any run: on the trial, it is one of your three.

You must own the agent you connect, or be authorised to test it. That confirmation is recorded and copied onto every run, so a report can always say on whose authority the test was performed.

## Changing or archiving an agent

Open the agent and go to its **Connection** tab. Under **Change the connection** you can change its name, endpoint URL, request body template, reply path, tool activity path, timeout, and the auth header and credential. The owner, an admin or an operator can do this; a reviewer or an auditor cannot.

- The request body must stay a JSON object with `{{input}}` or `{{messages}}` in it. It may also use `{{policy}}`, `{{context}}`, `{{history}}` and `{{conversation_id}}`. Any other placeholder is refused, because Novera would send it to your agent as written.
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
