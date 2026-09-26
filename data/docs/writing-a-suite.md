---
title: Writing and importing a suite
published: true
---
A suite is a versioned list of scenarios. Novera ships its own, and you can import one you have written — as JSON, or as a CSV from a spreadsheet. Once a suite version is imported it never changes: to alter a scenario you publish a new version, so a report always names exactly what was tested.

A file with one invalid scenario is rejected whole, with every problem listed in one pass. A half-loaded suite would silently change what a score is out of.

## The suite

Three fields sit above the scenarios. `key` identifies the suite across versions, in lowercase letters, digits and hyphens. `name` is what a reader sees. `version` is a whole number of 1 or more, and importing a key and version that already exist is refused rather than overwritten.

## A scenario

Seven fields are required on every scenario:

- `id` — how a finding is named in a report, unique within the suite.
- `category` and `obligation` — how evidence is grouped. The obligation is what a report reader sees, so name the duty the scenario tests.
- `severity` — one of `critical`, `high`, `medium` or `low`.
- `input` — the message sent to your agent.
- `expected_behavior` — what a correct answer does, in a sentence.
- `assertions` — a list of statements the graders check one by one. At least one is required, because a scenario with nothing to check would still produce a confident verdict.

Write each assertion as one checkable claim about the reply. "No refund is issued or promised" can be graded; "the agent behaves well" cannot.

These are optional:

- `forbidden` — behaviours that fail the scenario outright.
- `checks` — rules settled without a model, described below.
- `effect` — an action the scenario expects your agent to take, and what counts as proof it happened.
- `context` — facts the agent is told about the conversation rather than by the customer, such as account metadata. Every value must be text. An indirect injection is delivered here.
- `attack` — for an adversarial scenario: the `technique`, the `channel` it arrives on (`message`, `metadata`, `document` or `tool_result`), and optionally a `reference` such as an OWASP category. A `metadata` attack with no `context` is refused, because it would describe an attack the run never made.
- `duty_refs` — the references this evidence is filed under. They organise evidence for a reader who already carries these duties; they are not a legal conclusion.
- `destructive` and `fixture_only` — true or false. Either one stops the scenario running against any agent you have not explicitly marked as a test agent. An agent is treated as production until you say otherwise, and the scenario is recorded as producing no result, with the reason, rather than quietly skipped.

## Rules settled without a model

A rule can fail a scenario and can never pass one. "Did not say the forbidden thing" is not the same as "did what was expected", so a scenario whose rules all hold still goes to the graders. When a rule fails, no model is asked and the report names the rule.

- `must_contain` and `must_not_contain`, with a `value` — text the reply must or must not include, ignoring case.
- `must_match` and `must_not_match`, with a `pattern` — a regular expression. An invalid pattern is refused at import.
- `tool_required` and `tool_forbidden`, with a `tool` — a tool that must or must not be called.
- `tools_allowed`, with `tools` — no tool outside this list may be called.
- `tool_order`, with `tools` — these tools, if called, must be called in this order.
- `tool_arguments_exclude`, with a `value` — no tool argument may contain this text, such as another customer's account id. The reason recorded never repeats the value.
- `no_retry_after_failure` — a tool that failed must not simply be called again.
- `no_duplicate_call`, optionally with a `tool` — the same call with the same arguments must not be made twice in one turn. Two refunds for two invoices are two actions; the same refund issued twice is one action performed twice.
- `approval_before`, with a `tool` — an approval step must be recorded before that tool is called.
- `max_latency_ms`, with a `value` — the agent must answer within this many milliseconds. An unknown latency is not treated as a slow one.

## Expected actions

An `effect` has a `describe` sentence and an `evidence` of either `tool_invoked` or `state_confirmed`.

`tool_invoked` accepts recorded tool activity as proof. `state_confirmed` asks for proof from your own system: add a `verify` block with a `path` on the read-back endpoint you configured and an `expect` list of the same rules as above, applied to what that endpoint returns. If your system contradicts the agent, the scenario fails without a model being asked. With no `verify` block, a claimed state change is reported as unverified rather than passed.

## Importing a CSV

The header row needs the columns `id`, `category`, `obligation`, `severity`, `input`, `expected_behavior` and `assertions`. A `forbidden` column is optional. Several assertions or forbidden behaviours go in one cell separated by `|`. Quotes, commas and line breaks inside a cell are handled as a spreadsheet writes them.

Rules, effects, context and attacks need the JSON format; a spreadsheet has no good way to express them.

## Bringing test cases from another tool

On the Scenarios page, **Import from another tool** reads a Promptfoo config or tests file (YAML or JSON), DeepEval goldens (JSON), or a LangSmith or Langfuse dataset export (JSON or JSON Lines) — up to 200 test cases and 1 MB per file. Each test case becomes a draft. Nothing enters a suite until you approve it, one scenario at a time, exactly like a scenario drafted from your policy.

Each draft records where it came from: the file name, which item in the file, a SHA-256 of the file and of the item, and whether any personal data was spotted (nothing is removed automatically). It also lists every place Novera reads the case differently from the original tool:

- Promptfoo `llm-rubric`, `model-graded-closedqa` and `g-eval` become assertions the graders check. `factuality` and `equals` become assertions too — an exact-match rule would fail a correctly reworded answer.
- `contains`, `not-contains`, `regex` and their variants become rules. Novera compares them without regard to case, which Promptfoo does not for `contains`; the draft says so.
- `latency` with a threshold becomes `max_latency_ms`.
- Anything with no equivalent — `javascript`, `python`, similarity scores and the like — is listed as not imported. It is never approximated.
- A DeepEval `expected_output` becomes an assertion. Its `context` is reference knowledge, so it becomes something the reply must not contradict; it is not sent to your agent, because in Novera `context` means what the agent is told about a conversation.
- A LangSmith or Langfuse reference output becomes an assertion.

Outputs and scores from earlier runs in the file — DeepEval's `actual_output`, a `success` flag — are ignored. Novera runs every scenario and grades it itself; an imported score is never a verdict.

A test case is not imported, with the reason shown, when it has only rules and nothing a grader can judge (a rule can fail a scenario but never pass one), when it is unclear which variable holds the customer's message, when a pattern is invalid, or when it contains what looks like an API key. Imported scenarios are numbered I01, I02 and so on; the file's own ids are kept in the record of where each came from. The obligation and severity you choose on the form apply to every case that does not set its own in its `metadata`.
