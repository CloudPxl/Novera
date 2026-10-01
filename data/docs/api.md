---
title: The Novera API
published: true
---
A workspace API key lets a script, a CI pipeline or an AI assistant read your workspace's agents, suites, runs and verdicts without signing in. A key can also start runs only if you tick **Can also start runs** when you create it — each run it starts uses one of your trial runs, or grades on your own model key. No key can change a policy, approve anything, or publish or revoke a report.

## Keys

Create a key under **Settings → API keys**, one for each place you use it, so each can be revoked on its own. The key is shown once. Novera keeps only a keyed fingerprint of it, so a lost key cannot be recovered and a copy of our database cannot be used to call the API. Revoking a key is permanent and takes effect on the next request.

Send the key in a header on every request:

```
Authorization: Bearer nvk_…
```

A missing key gets a `401` that says how to send one. A key that is wrong, unknown or revoked gets the same `401` in every case. Each key may make 120 requests a minute; past that, requests get `429` until the minute is over. Every answer is JSON, including refusals.

## Endpoints

These are `GET`, under `https://www.nover.space/api/v1`. The two that write are below: starting a run, and recording a failure from production.

- `/agents` — your agents: name, host, whether it serves real customers, and its latest policy version. Policy text is never returned.
- `/suites` — the suite versions you can run: built-in and your own, with how many scenarios each has.
- `/runs` — recent runs, newest first. Add `?agent=<id>` for one agent and `?limit=` from 1 to 100 (default 20). Each run has its counts — passed, failed, no result — computed from its stored scenarios, its report's content hash and link if one was sealed, and `started_by`: `person`, `api_key` or `schedule`.
- `/runs/<id>` — one run and every scenario in it: verdict (`pass`, `fail` or `no_result`), the reason, how it was settled, whether the graders agreed, and any evidence gap. A scenario whose verdict has moved before under the same policy version also carries `stability` — how often it passed and failed, and `moved`: `graders` when your agent's reply was identical in runs graded differently, `agent` when its replies differed, `unknown` when that cannot be told. Add `?include=responses` to also get what each scenario sent and what your agent replied, turn by turn for a conversation. Each such read is recorded — which key, which run, and whether through this API or MCP — and listed under **Settings → API keys**, so a key handed to a pipeline or a contractor leaves a trail. Without it, personal data a grader quoted in a reason, such as an email address or a phone number, comes back as a placeholder, as it does in a report.

A run in another workspace, and an id that is not a run at all, both answer `404`: as far as a key is concerned, neither exists.

"No result" is never a pass. A report's own figures come from the sealed document; to check a report rather than a run, use its JSON download and the steps in **Reports in CI, and verifying a copy**.

## Starting a run from a pipeline

With a key that can start runs:

- `POST /api/v1/runs` with `{"agent_id": "…", "suite_id": "…"}` starts a run (the suite is optional; the newest built-in version is used otherwise). Add `"release_id"` and `"knowledge_base_revision"` to record what you are testing — up to 100 characters each; the report shows them as declared by you. It answers `201` with the run's id. The same checks apply as on the agent's page: the agent needs a policy version, the workspace needs a run left or its own model key, and the authorisation you recorded for the agent is attached to the run. A refusal answers `409` with the reason.
- Send an `Idempotency-Key` header — any 1 to 200 visible ASCII characters, new for each run you mean to start — and a retried request never starts a second run. The same key with the same body within 24 hours answers `200` with the run it already started and `"replayed": true`; nothing new starts and no trial run is spent. The same key with a different body answers `409`, and so does a retry that arrives while the first request is still starting its run: send it again in a few seconds. Keys belong to your workspace; another workspace's keys never collide with yours. Without the header, every request starts a run.
- `POST /api/v1/runs/<id>/execute` advances the run by about forty seconds of grading and answers with `done`. Call it until `done` is true. A call made while another is still working answers `started: false` and does nothing, so calling too often is harmless.

The run records which key started it, and the person who created that key as responsible for it.

When the run is done, `GET /api/v1/runs/<id>` gives its report's link; the JSON and JUnit downloads of that report carry the CI exit code (see **Reports in CI, and verifying a copy**). The `novera` command line does all of this in one step — `novera run --agent <id>`, with `--release` and `--kb-revision` to record what you are testing — but it is not yet published as a package. Whatever you use, keep the key in an environment variable or your CI's secret store, never in a command's arguments: arguments are visible to other processes and often printed in CI logs.

## Recording a failure from production

With a key that can ask for drafts and diagnoses, a helpdesk or incident pipeline can send a conversation that went wrong, and Novera drafts it as a regression scenario — the same as the form on the **Regressions** page:

- `POST /api/v1/production-failures` with `customer_message` and `expected_behavior` (what should have happened, in one sentence), `obligation` (for example `data_minimisation`) and `severity` (`low`, `medium`, `high` or `critical`); optionally `agent_reply`, `what_went_wrong`, `agent_id` and `occurred_on` (`2026-09-29`). Up to 4,000 characters for the message, 8,000 for the reply, 1,000 for the other two.

Everything is redacted before it is stored and the original text is never kept — see **Regressions from production** for what is and is not detected. It answers `201` with the failure's id, its draft (`R01`, `R02`…, status `draft`) and what redaction removed. The draft cannot run until a person approves it in Novera; nothing a key can do approves it, adds it to a suite or runs it. The failure and its draft name the key that sent them.

Sending the same text again — a retry, say — answers `200` with the first record and stores nothing new. An agent id from another workspace answers `404`, like one that does not exist. A workspace can record 60 new failures an hour this way; past that, `429`.

## With n8n

A ready workflow for [n8n](https://n8n.io) does the same without any code: download it from `https://www.nover.space/examples/n8n-novera-run-suite.json` and import it (**Workflows → Import from file**). It starts a run every Monday at 06:00, or when you press **Run now**, advances it every ten seconds until it is done, then fetches the result and takes one of two branches: **All passed**, or **Needs attention** — which a scenario with no result also takes, because no result is not a pass.

1. Create a credential of type **Header Auth** named `Novera API key`: name `Authorization`, value `Bearer nvk_…`, using a key that can start runs. The key lives in n8n's credential store, never in the workflow.
2. Open **Configure** and set `agent_id` and `suite_id` (from `GET /api/v1/agents` and `/suites`).
3. Connect whatever should hear about it — Slack, email, a ticket — after the two final nodes. Each carries an `outcome` (`pass`, `fail` or `incomplete`) and a one-line `message` with the report's link.

If a run has not finished after about fifteen minutes of advancing, the workflow stops waiting and takes **Needs attention** with the outcome `incomplete` — never **All passed**.

Three more workflows, set up the same way (the `Novera API key` credential, then **Configure**):

- **Pre-release gate** — `https://www.nover.space/examples/n8n-novera-release-gate.json`. Your release pipeline sends `POST` to the workflow's webhook with `{"release_id": "…", "knowledge_base_revision": "…"}` (both optional; the report shows them as declared by you) and waits for the answer: `200` with `outcome: pass` only when every scenario passed and a report was sealed; `409` otherwise, with `outcome` `fail`, `incomplete` (a scenario with no result, or a run that did not finish) or `blocked` (the run could not start, with Novera's reason). Fail the release step on anything but `200`. The webhook demands a secret: create a **Header Auth** credential named `Release gate secret` with a header name and a long random value, and send that header from the pipeline — without it, anyone who learned the webhook's address could spend your runs. The call stays open while the suite runs; allow it a few minutes.
- **Weekly assurance** — `https://www.nover.space/examples/n8n-novera-weekly-assurance.json`. Every Monday it runs the suite and compares the result with the last completed run of the same suite version for that agent. It reaches **Open a ticket** only for a scenario that passed last time and failed now, a scenario with no result, or a run that did not finish or seal a report; otherwise **Nothing to do**. A newly failing scenario whose identical reply was graded both ways before is still listed, and labelled as the graders moving rather than the agent. Replace **Open a ticket** with your Jira, Linear or email node; it receives a `title` and a `message`.
- **Incident to regression draft** — `https://www.nover.space/examples/n8n-novera-incident-to-regression.json`. Your helpdesk sends a conversation that went wrong to the workflow's webhook; it records it through `POST /api/v1/production-failures` (so it needs a key that can ask for drafts and diagnoses) and answers with the draft's number and where to review it. Adapt the five fields in **Map the incident** to your helpdesk's payload. Like the gate, the webhook demands a secret: a **Header Auth** credential named `Incident webhook secret`.

Each was run in n8n 2.41 against Novera before it was published: every branch above, including the refusals. The three that start a run send an `Idempotency-Key`, made once per execution, and retry a request that fails, so a timeout never starts and spends a second run; an answer that the run already started is followed like a new one.

## Webhooks

Instead of polling, Novera can tell another system when something happens. Add an endpoint in **Settings → Webhooks** — an https address on the public internet — and choose the events: `run.completed` (a run finished, with its counts, its outcome `pass`, `fail` or `incomplete`, and the report link), `run.stopped` (stopped by a person, or ended by an error — always `incomplete`, never a pass) and `schedule.paused` (with the reason). A delivery never carries your agent's replies, the scenarios' messages, your policy or any key. A stopped run's reason is one of three fixed sentences — stopped by a member of the workspace, stopped after 24 hours with nothing graded, or ended by an error — never who stopped it or the error's own words; the run page has those. Each run is queued once for each endpoint subscribed when it finished. If a run finishes and Novera stops before queueing its announcement, the clock finds it within a few minutes and sends it then.

Every delivery is a `POST` with a JSON body and three headers: `Novera-Event`, `Novera-Delivery` (a unique id, for ignoring a repeat) and `Novera-Signature: t=<unix time>,v1=<hex>`, the HMAC-SHA256 of `<t>.<body>` under the endpoint's signing secret, which is shown once when you add the endpoint. Check it before trusting the body:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function fromNovera(secret, rawBody, header, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(now / 1000 - Number(parts.t)) > 300) return false; // older than five minutes
  const expected = createHmac("sha256", secret).update(parts.t + "." + rawBody).digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

Answer with any `2xx` to acknowledge. Anything else, or no answer within five seconds, is retried after 1, 5 and 30 minutes, then 2 and 6 hours, and then given up; Settings shows each delivery's last answer. Redirects are not followed, and your endpoint's response body is never read.

Delivery is **at least once**, not exactly once. Each attempt is sent by one sender, but if your endpoint answered and Novera stopped before recording the answer, the same delivery is sent again with the same `Novera-Delivery` id. Treat an id you have already handled as done.

## For AI assistants (MCP)

The same key opens an MCP server at `https://www.nover.space/api/mcp`, so an assistant that speaks the Model Context Protocol — Claude, Cursor and others — can answer questions such as "what failed in the last run, and why?" from your stored evidence. In Claude Code:

```
claude mcp add --transport http novera https://www.nover.space/api/mcp --header "Authorization: Bearer nvk_…"
```

Every key gets seven read-only tools: `list_agents`, `list_suites`, `list_runs`, `get_run`, `get_evidence_gaps` (scenarios with no verdict, missing evidence or uncorroborated graders), `compare_runs` (fixed, still failing, newly broken, lost or regained a verdict) and `verify_report` (recomputes a sealed report's hash). What else the assistant is offered follows what you ticked when you created the key:

- **Can also start runs** adds `start_run` and `advance_run` — the same checks as the run button, and each run uses a trial run or grades on your own model key.
- **Can also ask for drafts and diagnoses** adds `draft_scenarios` (scenarios drafted from the agent's latest policy, each quoting the passage it tests) and `request_diagnosis` (why one scenario failed, and the policy change that would have prevented it). What they produce lands as a draft or a proposal, marked as asked for by an assistant with that key. At most 20 an hour per workspace.

No key, whatever it can do, approves or rejects a draft or a proposal, changes a policy, publishes or revokes a report, or sends anything. Those stay with a person in Novera, and the tools answer with the link to decide there.

The server keeps no session: every request carries the key, and requests from a web page on another site are refused. It counts against the same 120 requests a minute as the rest of the API.
