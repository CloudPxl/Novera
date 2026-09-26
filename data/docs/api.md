---
title: The Novera API
published: true
---
A workspace API key lets a script, a CI pipeline or an AI assistant read your workspace's agents, suites, runs and verdicts without signing in. Keys are read-only: they cannot start a run, change a policy, approve anything, publish or revoke a report.

## Keys

Create a key under **Settings → API keys**, one for each place you use it, so each can be revoked on its own. The key is shown once. Novera keeps only a keyed fingerprint of it, so a lost key cannot be recovered and a copy of our database cannot be used to call the API. Revoking a key is permanent and takes effect on the next request.

Send the key in a header on every request:

```
Authorization: Bearer nvk_…
```

A missing key gets a `401` that says how to send one. A key that is wrong, unknown or revoked gets the same `401` in every case. Each key may make 120 requests a minute; past that, requests get `429` until the minute is over. Every answer is JSON, including refusals.

## Endpoints

All are `GET`, under `https://www.nover.space/api/v1`.

- `/agents` — your agents: name, host, whether it serves real customers, and its latest policy version. Policy text is never returned.
- `/suites` — the suite versions you can run: built-in and your own, with how many scenarios each has.
- `/runs` — recent runs, newest first. Add `?agent=<id>` for one agent and `?limit=` from 1 to 100 (default 20). Each run has its counts — passed, failed, no result — computed from its stored scenarios, and its report's content hash and link if one was sealed.
- `/runs/<id>` — one run and every scenario in it: verdict (`pass`, `fail` or `no_result`), the reason, how it was settled, whether the graders agreed, and any evidence gap. Add `?include=responses` to also get what each scenario sent and what your agent replied, turn by turn for a conversation.

A run in another workspace, and an id that is not a run at all, both answer `404`: as far as a key is concerned, neither exists.

"No result" is never a pass. A report's own figures come from the sealed document; to check a report rather than a run, use its JSON download and the steps in **Reports in CI, and verifying a copy**.

## For AI assistants (MCP)

The same key opens a read-only MCP server at `https://www.nover.space/api/mcp`, so an assistant that speaks the Model Context Protocol — Claude, Cursor and others — can answer questions such as "what failed in the last run, and why?" from your stored evidence. In Claude Code:

```
claude mcp add --transport http novera https://www.nover.space/api/mcp --header "Authorization: Bearer nvk_…"
```

It offers seven tools, all read-only: `list_agents`, `list_suites`, `list_runs`, `get_run`, `get_evidence_gaps` (scenarios with no verdict, missing evidence or uncorroborated graders), `compare_runs` (fixed, still failing, newly broken, lost or regained a verdict) and `verify_report` (recomputes a sealed report's hash). There is no tool that starts a run, changes a policy, approves anything, or publishes or revokes a report.

The server keeps no session: every request carries the key, and requests from a web page on another site are refused. It counts against the same 120 requests a minute as the rest of the API.
