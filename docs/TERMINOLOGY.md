# Terminology

The words Novera uses, in the product, the reports, the documentation and the code. One meaning
each, everywhere: a word that means two things at a boundary has cost this project eight debugging
sessions (CLAUDE.md, "Rules learned the hard way"). `npm run lint:copy` (`tests/copy-terms.test.ts`)
refuses the phrases at the bottom of this page.

| Term | Means | Never |
|---|---|---|
| **Agent** | The customer's software being tested: a support assistant reached over HTTP. | "bot", "model" (a model is something else here) |
| **Endpoint** | The address the agent answers on, with its request template and response path. | "target" in customer copy (fine in code) |
| **AI grader** (or **grader**) | A language model that reads the agent's reply against the scenario and votes pass or fail. Each vote names its model. | "reviewer", "auditor", "judge" in customer copy, "who graded" — a grader is not a person |
| **Model** | A specific language model, named as its connection and id (e.g. `gemini/gemini-3.8-flash`). | a vendor's marketing name |
| **Provider** / **vendor** | The company behind a model (Google, Groq, Mistral). Two models from one vendor are one vendor, so their agreement is not independent. | "API" |
| **Rule** | A deterministic check in a scenario (must not contain, tool forbidden, card number). It can fail a scenario, never pass one. | "test" |
| **Read-back** | A read-only call to the customer's system that confirms or contradicts an action the agent claimed. | "verification" without saying of what |
| **Scenario** | One test case: an input (sometimes earlier turns), the expected behaviour, rules, a severity. | "test", "prompt" |
| **Suite** | A versioned set of scenarios. A version never changes; its SHA-256 digest is recorded on every run. | "benchmark" |
| **Run** | One execution of a suite against an agent, with everything declared before it started. | "evaluation" in headings (fine in prose), "audit" |
| **Verdict** | Pass or fail for one scenario, from a rule, a read-back or AI graders. | "score" for a single scenario |
| **No result** | No verdict was reached. One of seven categories (below). Never a pass, never a failure. | "error" alone in customer copy, "skipped" |
| **Report** | The dated, hash-sealed record of a run's verdicts and evidence, with its scope and limitations. Testing evidence. | "certificate", "certification", "compliance report", "audit", "proof of safety" |
| **Seal** | The SHA-256 digest over a report's content, chained to the previous report for the agent. It proves the report has not changed since sealing. | "proof of safety", "proof of compliance" |
| **Finding** | A person's note beside a verdict. It never replaces the verdict. | "review" of a verdict by Novera |

## The seven no-result categories

Computed by `src/lib/evidence/diagnostics.ts` from the twenty typed reasons in
`src/lib/evidence/repair.ts`. Customer explanation: `data/docs/reading-a-report.md`, "When a scenario
has no result".

| Category | Means | From these reasons |
|---|---|---|
| Not run | Held back before sending: the setup cannot carry it, or the agent is production | `production_guard`, `no_metadata_slot`, `no_conversation_slot` |
| Could not complete | Sent; no complete reply arrived | `agent_timeout`, `agent_unreachable` |
| Result unavailable | The agent answered; the answer could not be read as a reply | `agent_http_error` (a redirect, 401 or 403 is configuration instead), `agent_malformed`, `agent_too_large`, `unclassified` |
| Inconclusive | Graders split and nothing settled it, or a claimed action could not be checked | `unsettled_disagreement`, `action_not_verified`, `readback_unavailable` |
| Blocked by configuration | A setting stopped it: address, response path, data the graders may not receive, or the workspace's own grading key | `not_sent_address`, `agent_response_path`, `graders_refused_data_class`, and grader failures on the workspace's own key |
| Blocked on Novera's side | The agent replied; Novera's graders were limited, slow or unreachable, or the time slice ended | `cut_by_slice`, and grader failures on Novera's keys |
| Withdrawn or expired | A report withdrawn by its workspace or past its link's expiry | report state, not a case |

## Phrases the copy check refuses

"who graded / who decided it / who judged", "something went wrong", "try again later", "unknown
error", "an error occurred", "check your settings", "guarantee(s) … compliance / conformity /
safety", "certified compliant", "compliance certificate", "guaranteed safe", "proof of safety",
"our human reviewers checked". Each failure names what to write instead.
