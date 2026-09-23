# Competitive position

Read alongside `docs/THREE-PS.md` and `docs/DECISIONS.md`. Sourced from three research
documents reviewed 2026-09-22: the AI-agent testing landscape, the TestMu AI dossier, and
the TestRail dossier. This file records what changed in the product because of them, what
did not, and why — not a summary of the research, which you can read yourself.

## The one fact that matters most

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
