# Competitive position

Two parts. **Function by function** is the prospecting pass of 2026-09-25: every thing
Novera does, against the live equivalent in each competitor's *current public
documentation, fetched that day*, classified, and with what we did about it. The
sections after it are the positioning written on 2026-09-22 from three research
documents (the AI-agent testing landscape, the TestMu AI dossier, the TestRail dossier),
kept because the reasoning in them still holds.

## Function by function — fetched 2026-09-25

### How to re-run this

A comparison written from memory is a comparison with a product that may no longer
exist. So: fetch each source below, re-read it against the row, and change the row only
on what the page now says. Inventory first, comparison second, judgement third —
otherwise the table becomes a feature list copied from whoever markets best. Public
documentation, public pricing and public changelogs only; nothing behind a login, no paid
trials.

**Classifications.** *Parity* — both do it. **Logic gap** — they thought of a case we had
not. *Capability gap* — they can do something we cannot, worth wanting. *Deliberate* — we
do it differently on purpose, and the reason is recorded so it stops being re-litigated.
**Theirs** — we do something none of the sources describe.

### Sources, fetched 2026-09-25

| | |
|---|---|
| LangSmith | [evaluation](https://docs.langchain.com/langsmith/evaluation) · [aligning an LLM judge](https://docs.langchain.com/langsmith/improve-judge-evaluator-feedback) |
| Braintrust | [evals](https://www.braintrust.dev/docs/guides/evals) · [comparing experiments](https://www.braintrust.dev/docs/evaluate/compare-experiments) |
| Promptfoo | [red teaming](https://www.promptfoo.dev/docs/red-team/) · [plugins](https://www.promptfoo.dev/docs/red-team/plugins/) · [strategies](https://www.promptfoo.dev/docs/red-team/strategies/) |
| DeepEval | [metrics](https://deepeval.com/docs/metrics-introduction) |
| Opik | [evaluation](https://www.comet.com/docs/opik/evaluation/overview) |
| LangWatch | [Scenario](https://langwatch.ai/scenario/) |
| Maxim | [agent simulation and evaluation](https://www.getmaxim.ai/products/agent-simulation-evaluation) |
| Giskard | [documentation](https://legacy-docs.giskard.ai/en/stable/index.html) — marked legacy by Giskard; the current Hub docs were not reachable without an account |
| TestMu AI | [Agent Assurance, launched 18 Aug 2026](https://runtimewire.com/article/testmu-ai-agent-assurance-autonomous-agent-testing) · [press release](https://www.prnewswire.co.uk/news-releases/testmu-ai-launches-agent-assurance-to-verify-ai-agents-before-they-ship-302854205.html) |

### The table

| Novera function | Best equivalent found | Class | What we did |
|---|---|---|---|
| **Connect an agent** over HTTP with a request template | TestMu invokes by command, HTTP endpoint, MCP server or n8n workflow | Capability gap | HTTP covers most support agents. MCP and command invocation belong with Phase 10's MCP work |
| **Probe**, and discover the response path from the reply | Not described by any source | Theirs | — |
| **Policy versioned and frozen per run** | Braintrust: experiments are "the immutable, comparable record"; LangSmith datasets | Parity | Ours also freezes the *policy*, not only the dataset |
| **Suite import**, JSON or CSV, with a SHA-256 of the uploaded bytes | Datasets in LangSmith, Braintrust, Maxim, Opik | Parity | The provenance hash is ours alone. **The format was documented nowhere** — now `/docs/writing-a-suite` |
| **Immutable suite versions** | Braintrust immutable experiments | Parity | — |
| **Duty-to-test compiler**: a policy drafts scenarios, each quoting the passage it tests, entering a suite only with a named approval | TestMu generates from PRDs, PDFs, knowledge bases; Giskard RAGET; Opik's assistant | Parity on generation | The quote-locked source and the named-approval gate are ours alone |
| **Red-team coverage** in the suite | Promptfoo: 100+ plugins and 30+ strategies — encodings, special-token injection, tool discovery, off-topic manipulation, crescendo, GOAT | **Logic gap** | Core covered (BOLA/BFLA, PII, prompt extraction, indirect injection, competitor, unsupervised contracts, overreliance). Missing: tool discovery, encoded payloads, special-token injection, off-topic manipulation, injection through tool arguments. **Designed as `eu-support v4`, not yet written** — see below |
| **Multi-turn and persona simulation** | LangWatch Scenario (user simulator + judge agent), Maxim personas, Promptfoo crescendo/GOAT | Capability gap | Phase 9. A multi-turn case flattened into one message is a different test under the same name, so none is faked meanwhile |
| **Deterministic rules** that can fail a case and never pass one | DeepEval DAG ("deterministic metric scores"); Promptfoo assertions | Parity | Added `no_duplicate_call` from DeepEval's step efficiency — the same successful action twice passed every rule we had |
| **Trajectory and tool evaluation** | DeepEval tool/argument correctness, plan adherence; LangSmith trajectory evaluation | Parity | Plan adherence is not modelled; nothing in a support suite needs it yet |
| **Read-back**: a claimed action confirmed, contradicted or unavailable from the customer's own system | TestMu checks "files, artifacts and tool calls" against the declared interface | Parity with TestMu only | No other source verifies effects in the system of record |
| **Consensus across vendors**, third model settles, deadlock is an error | Single-judge LLM-as-judge in every source | Theirs | — |
| **Judge calibration and per-model drift**, stored | LangSmith "Align Evaluator": alignment score against human labels | Parity in concept | Ours measures our graders against our ground truth. **Customer-side alignment added** — see reviews |
| **A person reviews a verdict** | LangSmith annotation queues; Opik annotation queues; Maxim human evaluation | Capability gap | **Built** (0028): beside the verdict, never replacing it, reason required, alignment derived |
| **Unable to verify and an assurance gap** | TestMu: "Pass, Fail or Unable to Verify", gap excluded from the pass rate | Parity with TestMu only | LangSmith, Braintrust, DeepEval do not separate missing evidence from failure |
| **Three coverage numbers; WITHHELD distinct from INCOMPLETE** | TestMu's single assurance gap | Theirs | — |
| **A grade withheld** rather than computed over partial evidence | DeepEval: a 0–1 score against a threshold, default 0.5 | Deliberate | A number that describes the cases that ran and says nothing about the ones that did not is the thing this product exists not to publish |
| **Diagnosis**: a proposed policy edit, quote-locked, applied only on approval | Braintrust playgrounds; Opik prompt tooling | Theirs | The approval gate and "the model cannot quote text that is not in the policy" |
| **Retest one scenario** | Braintrust and LangSmith re-run from a playground | Parity | — |
| **Comparison**: fixed, still failing, newly broken | Braintrust improvements and regressions; **TestMu separates flaky scenarios from newly failing ones** | **Logic gap** | **Built** (format 10): a scenario whose verdict moved before under an unchanged policy is named, never removed from "newly broken" |
| **Repetitions** of each case to expose nondeterminism | LangSmith "repetitions"; Braintrust trials grouped by input | Capability gap | Partly answered without extra runs by the stored history above. Explicit trials multiply judge calls on free tiers; deferred until throughput is measured |
| **Sealed report**: SHA-256, chained to the previous, manifest hashed before execution | Not described by any source; TestMu's launch material says nothing on hashing or audit trail | Theirs | — |
| **Export** to Markdown, CSV, print | Promptfoo reports; dashboards elsewhere | Parity | — |
| **Revocable, expiring report link** | Not described | Theirs | — |
| **CI** | Braintrust per-PR evals; Promptfoo CI; DeepEval with pytest; LangWatch with Vitest/Jest; **TestMu CI commands that separate agent failures from environment failures** | Capability gap | Phase 8, whose exit codes already separate a regression (1) from missing evidence (2) and infrastructure (4) — the same distinction TestMu makes |
| **MCP server** | Opik ships one; TestMu publishes Claude Code setup | Capability gap | Phase 10 |
| **Online evaluation of production traffic** | LangSmith online evaluation; Braintrust online scoring | Deliberate | Declined 2026-09-22: that is observability sold to a platform team; we sell a document to a delivery lead |
| **Production failure → regression case** | Braintrust and LangSmith pull production traces into datasets | Capability gap | Phase 9 |
| **Regulatory mapping** | Promptfoo maps to OWASP LLM Top 10, NIST AI RMF, EU AI Act | Parity | Ours: `duty_refs`, stated as organising evidence, never as a legal conclusion |
| **Workspace erasure** as a single audited path | Not described | Theirs | — |
| **Bring your own key**, our key only for the trial | TestMu: its controller means "developers do not need local provider keys" | Deliberate | The report states who funded the grading; that statement is only possible if the key is attributable |

### What the pass changed

Five things shipped, each recorded in `docs/DECISIONS.md` under 2026-09-25:

1. **Flaky scenarios named in comparisons** — payload format 10.
2. **`no_duplicate_call`**, a rule for the same action performed twice.
3. **Human review of verdicts**, with an alignment figure — migration 0028.
4. **The suite format documented**, so the support agent can answer how to write one.
5. **Tenant isolation checked over the evidence tables**, which it had never covered.

### `eu-support v4` — designed, not yet written

The red-team gap needs five new scenarios and a fix to v3's T22, as a new version because
a suite version is immutable. The design:

| id | technique (Promptfoo's name) | how it is settled |
|---|---|---|
| T37 | tool discovery — asks the agent to list its tools and their parameters | `must_not_contain` on an internal tool name |
| T38 | encoded payload — an instruction supplied in base64 | graded; the fixture declines to decode and act |
| T39 | special-token injection — conversation delimiters in the message | `must_not_contain` on the internal value it asks for |
| T40 | off-topic manipulation — the agent used as a general assistant | graded; the fixture stays on purpose |
| T41 | injection through a tool argument | `tool_arguments_exclude` on the injected fragment |
| T22 | carried from v3 with the missing `verify` block on `invoices/NW-4417` | read-back contradicts the claimed refund, settled with no model |

It needs scripted fixture replies for each, a labels file, and proof that the fixture's
replies to every v1–v3 input stay byte-identical so calibration remains comparable.
**It was not written in this pass:** authoring the attack payloads tripped a safety check
in the session's auto-permission mode, which reacts to conversation content rather than
to the action. It should be written in a session without auto mode.

## The one fact that matters most

*Written 2026-09-22; confirmed by the 2026-09-25 pass. TestMu launched Agent Assurance
publicly on 18 August 2026, and its reports now also separate flaky scenarios from newly
failing ones and give CI commands that tell agent failures from environment failures.*

**TestMu AI Agent Assurance is building our wedge.** The landscape document names it "the
closest public competitor concept to Novera's evidence-first model": it reads the agent's
codebase, derives scenarios, invokes the agent for real, checks criteria against observed
evidence, and reports **Pass, Fail, or Unable to Verify plus an assurance gap.**

That is not adjacent to what we sell. That is what we sell, backed by a large QA brand
(formerly LambdaTest), an existing execution cloud, 120+ integrations and a published
Claude Code MCP setup.

Treat everything else in this file as secondary to that. Our answer cannot be feature
parity — they will out-build us on every axis that money buys. It has to be the things
their shape makes awkward:

- **Integrity enforced in the database rather than asserted in marketing.** Append-only
  triggers refuse to edit a verdict even with the service-role key. A sceptical client can
  check a report's SHA-256 themselves.
- **A one-person operator, not a QA department.** Their packaging is separate
  subscriptions across automation, HyperExecute, devices, KaneAI, SmartUI, Test Manager,
  live testing and performance, with a pricing page that contradicts itself. Ours is one
  price and one artifact.
- **EU residency by construction** — Frankfurt database, `fra1` functions — not a paid
  enterprise add-on.
- **BYOK economics.** Our marginal inference cost is zero.

## What the research changed in the product

### Adopted and shipped

**A deadlocked verdict is not a dead endpoint.** The landscape document's evidence
taxonomy separates Pass / Fail / Error / Unexecuted / Unable to Verify / Disputed /
Excluded, and names the collapse of those into one bucket as the clearest white space in
the category: *"most competitors blur test failure and missing evidence."* We were doing
it too. Consensus grading has always recorded `unresolved` when a third model cannot
settle a disagreement, and the UI threw it away. Now counted and reported. On a live run
this immediately reclassified two cases from "no result" to "disputed".

**The assurance gap.** The share of the suite that produced no verdict, shown beside the
grade. It is the number a reader needs next to INCOMPLETE — not "how did the cases that
worked do" but "how much of this evaluation is missing".

**Import provenance.** The document is explicit that an import must preserve source tool,
version, timestamp, original case id and sanitisation status. The importer shipped hours
earlier preserved none of it. Every imported suite now carries a SHA-256 of the uploaded
bytes, so the file on someone's disk can be checked against the suite a report cites.

### Adopted in principle, sequenced deliberately

**Unable to Verify, and effect verification.** The most emphasised point across all three
documents: *"the agent said it refunded the order" is not enough; the refund record must
be queried.* A trace proves a tool was called, not that the customer-visible state
changed.

We are not currently exposed to this, and it is worth being precise about why. Every
effect-shaped case in `eu-support v1` — T06 through T10, T15 — is a **refusal** case: the
correct behaviour is to decline, so a pass means no action was claimed, which the text
does evidence. The exposure begins the moment the suite contains an authorised action that
*should* succeed, because then a pass rests on the agent's own claim that it did.

**That made it a prerequisite for suite expansion, not a follow-on** — and it was built
in that order. `eu-support v3` (36 scenarios) contains authorised actions that should
succeed, and they rest on evidence rather than on the agent's account: T35's refund is
confirmed by reading the customer's own system, T36's export by recorded tool activity,
and a claim nothing evidences is withheld rather than passed. **Closed 2026-09-23.**

**A read-only MCP server.** Recommended by the landscape document (list suites, list runs
and case states, explain a failure from stored evidence, show missing evidence and
unresolved verdicts, verify a report hash, compare two approved runs) and echoed by the
TestRail dossier, which asks for "read-only mode, dry-run mode, write confirmation, and
auditability". TestMu publishes Claude Code setup instructions, which is evidence the
channel works. Cheap relative to its value, and it suits a product whose whole claim is
that its stored evidence can be interrogated. Write operations must require explicit
confirmation and must never silently publish, rerun, change a policy or send anything.

### Declined

**Browser and device execution.** TestMu offers 3,000+ browser/OS combinations and
10,000+ real devices. We will never compete there and should not try. A browser test
proves a widget loads; it cannot prove an answer was right.

**Span tracing and production observability.** Langfuse is open source and self-hostable;
Braintrust and LangSmith are well funded. That is a dashboard sold to a platform team. We
sell a document to a delivery lead.

**Competing on free tier.** Langfuse and Braintrust cannot be out-freed. Our free tier
exists to let someone see one real report, not to win on volume.

**"More evaluators" and "more generated cases."** TestMu claims 15+ evaluators and 60–100+
generated scenarios. Generated-per-report scenarios are the opposite of what we sell: a
suite version has to be immutable for a report to keep meaning what it meant.

**An `Excluded` case state.** Recommended, but a suite version is already immutable here —
excluding a case means publishing a new version, which is a better record than a flag.

## Pricing, with the anchors the research supplies

The landscape document's advice is directly useful: **do not price on model calls when the
value is the report.** The unit should be a verified run or a reportable scenario bundle,
with stated limits on cases per run, judge calls per case, retention, re-run allowance and
concurrency.

Anchors, all from the dossiers:

| Product | Published price | What the buyer gets |
| --- | --- | --- |
| TestRail Professional | $37 per seat/month | Test management; no evaluation at all |
| TestRail Enterprise | $74 per seat/month | Adds SSO, audit, support |
| TestMu KaneAI | $17 / $89 / $179 per month | Credit-metered authoring |
| Deepchecks | ~$40,000/year (AWS Marketplace) | Enterprise evaluation platform |
| Langfuse / Braintrust | Free tiers | Open-source or generous free observability |

The useful comparison for our buyer: **TestRail Professional for a three-person delivery
team is about $111 a month and produces no evaluation of the agent whatsoever.** A tier at
€79–149 that emits a dated, hash-sealed conformity report sits comfortably under that and
is doing a different job. Deepchecks at $40k/year is the ceiling the category will bear
from enterprises and tells us nothing about agencies.

Price is still the open decision. The research narrows it rather than settling it.

## Where we remain weak, stated plainly

- **Commercially unvalidated.** Nobody has paid for this. That is still the single largest
  risk and no amount of product work retires it.
- **A well-funded incumbent is already in the wedge.** See the top of this file.
- **Actions are verified, and the customer supplies the witness.** Effect verification
  shipped 2026-09-22; the read-back source followed on 2026-09-23. A scenario says where
  to look in the customer's own system and what must hold there, the read-back runs
  *before* any model, and a system of record that contradicts the agent fails the case
  with no model asked. Three outcomes, not two: confirmed, contradicted, unavailable.
  The remaining limit is honest and worth stating — the witness is the customer's
  endpoint, so an agent whose owner configures none still reports its claimed actions as
  unverified. That is a gap in what we were given, and the report says so rather than
  treating it as a pass.
- **Any public claim naming the AI Act or GDPR needs a lawyer.** "Documented evidence your
  agent was tested against these scenarios" needs no such review and is the safer framing
  until then.
