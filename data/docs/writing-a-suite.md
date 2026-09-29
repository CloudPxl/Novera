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
- `earlier_turns` — makes the scenario a conversation: a list of up to eight messages the customer sends before `input`. See below.
- `persona` — a simulated customer who continues the conversation after `input`. See below.
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
- `tool_arguments_include`, with a `tool` and a `value` — every call to that tool must carry this text in its arguments: the refund goes to the invoice the customer named, not a neighbouring one. It says nothing when the tool is not called; use `tool_required` for that.
- `no_retry_after_failure` — a tool that failed must not simply be called again.
- `no_duplicate_call`, optionally with a `tool` — the same call with the same arguments must not be made twice in one turn. Two refunds for two invoices are two actions; the same refund issued twice is one action performed twice.
- `approval_before`, with a `tool` — an approval step must be recorded before that tool is called.
- `max_latency_ms`, with a `value` — the agent must answer within this many milliseconds. An unknown latency is not treated as a slow one.

## Conversations

Some failures only appear on the third time of asking: an agent that refuses a credit twice and gives it the third time passes every single-message test. A scenario with `earlier_turns` sends each of those messages as its own turn, with the conversation so far, and then sends `input` as the final message.

To hold one turn to its own rule, add `turn_checks`: a list of `{"turn": 2, "checks": [...]}`, where turns count every customer message from 1 and `input` is the last. Those rules are checked against that turn's reply and tool calls alone, and a failure names the turn — "Turn 2 of 3: the agent called `cancel_subscription`" — so you see where the agent crossed the line, not only that it did.

The verdict is on the whole conversation. Rules apply to everything the agent said and did in every turn — a refund in the second turn fails the scenario even if the last reply refuses — and the graders read every reply, labelled by turn. The run page shows the conversation turn by turn.

Your agent has to be able to receive a conversation. Add `{{history}}` to its request body where it expects earlier messages — as a whole value, it becomes a list of `{"role": "user" | "assistant", "content": …}` messages — or `{{conversation_id}}` if your agent keeps conversations itself; the id stays the same for every turn of one scenario. An agent with neither is not sent the scenario at all, and it is recorded as having no result, with the reason. Sending the turns as unrelated messages would test something else under the scenario's name.

If any turn gets no reply, the scenario has no result and says which turn failed.

## A simulated customer

Instead of scripting every turn, a scenario can describe a customer and let a model play them. `input` is still the opening message, written by a person, so the first turn is always the same. `persona` then says who the customer is:

- `goal` — what they want, in a sentence.
- `max_turns` — how many more messages they will send after the opening, from 1 to 6.
- `style` — how they behave: "persistent and polite, relabels the request when refused", "confused, gives partial details".
- `language` — optional; the opening message sets it otherwise.
- `facts` — optional; things they know and may reveal if asked, such as an order number.

The model playing the customer never sees the scenario's assertions — a customer who knew the rubric would steer the agent towards it. It stops when the goal is met or a person like this would give up, and never after `max_turns`. It is funded like grading: the trial allowance, or your own key.

Every message it writes is marked as a simulated customer on the run page, with the model that wrote it, and a report that includes such a conversation says in its limitations that no real customer took part. A simulated conversation can be phrased differently from one run to the next, so compare runs with that in mind; a scripted conversation (`earlier_turns`) is the same every time. A scenario has one or the other, not both.

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
