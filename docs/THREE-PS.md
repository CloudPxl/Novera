# Novera — Pain, Person, Promise

Filled from Nate Herk's worksheet, reframed around conformity evidence.
Everything marked UNVERIFIED is a hypothesis we have not yet tested with a real buyer.
Do not promote a line to fact without a recorded conversation or a paying customer.

## Pain
**The recurring problem:** An agency ships an AI support agent to a client and cannot
show, in a form the client's legal or ops side accepts, how that agent behaves on the
cases that carry risk — refunds, deletion requests, identity changes, data export,
escalation, instruction-injection. Every prompt or model change silently invalidates
whatever was checked last time.

**How it is handled today (UNVERIFIED):** Manual spot-checks in a chat window,
screenshots pasted into a doc, a spreadsheet of test questions someone maintains
until they get busy. No versioning, no dated evidence, no way to prove the agent that
was tested is the agent that shipped.

**Time, cost, or risk created (UNVERIFIED):** Re-testing effort on every change; a
client asking "how do you know it won't refund the wrong person" with no good answer;
exposure when an EU client's own compliance review works backwards to the vendor.

**What makes it urgent:** EU AI Act obligations phasing in through 2026 plus existing
GDPR duties (erasure, identity verification, data access, automated handling of
personal data) mean the agency's client increasingly has to *document* how a
customer-facing AI system behaves. The agency inherits that request and currently
has nothing to hand over.

## Person
**Exact role:** Founder / delivery lead at an agency or dev shop that builds and
operates AI support agents for clients. Secondary: the in-house engineer at an EU
scale-up who owns a customer-facing agent.

**Company type and size:** 3-30 people, EU-based or selling into the EU, delivering
per-client agents rather than one product.

**Who approves the purchase:** The founder or delivery lead. One person, no committee.
This is what makes the business operable by two people.

**Where you can find them:** Public case studies and portfolio pages mentioning AI
support agents; EU automation and AI-build communities; job posts for agent builders;
agencies partnered with support-platform vendors.

## Promise
**Input the buyer provides:** An agent they own or are authorised to test (endpoint or
system prompt), their approved policies, and the scenario suite they accept.

**Result the software returns:** A dated, hash-sealed conformity report showing, per
scenario: the exact input, the agent's actual response, the expected behaviour, the
verdict with a stated rationale, and the obligation that case evidences — plus
coverage counts and a diff against the previous run.

**How we measure that result:** Every figure is computed from stored run rows.
Errored and unexecuted cases are reported separately and never counted as passes.
The report hash verifies against the stored run.

**What the promise does not cover:** Novera is not a legal certification, not a
guarantee of compliance, and not proof that untested interactions are safe. It is
evidence that a defined suite was executed against a defined agent version on a
defined date, with the results preserved as they occurred.

## Positioning
For agencies and dev shops deploying AI support agents to EU clients, Novera turns a
live agent into a dated, verifiable conformity report — so quality is evidence, not
opinion.

## First validation conversations (five EU agencies, before any pricing claim)
1. Walk me through the last time you checked an agent before handing it to a client.
2. Has a client ever asked you to show how the agent behaves? What did you send?
3. What happens to that check when you change the prompt or swap the model?
4. Who owns it if the agent does something it should not have?
5. Would you run one real agent through this under agreed pilot terms, and what
   would make it worth paying for monthly?

Record exact answers. Do not fill missing evidence with assumptions.
