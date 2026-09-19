# Decision log

Append-only. Newest last. One entry per decision that would otherwise have to be
re-derived later. Keep entries short; link to the file that implements them.

## 2026-09-19 — Positioning: conformity evidence, not agent scores
Nate Herk's "Agent Report Card" is the base model. Sold as QA it is a nice-to-have
and trivially cloneable. Reframed as EU conformity evidence it maps to an obligation
the buyer already has, is recurring by construction (every policy or model change
invalidates the last report), and is defensible against a US clone because EU data
residency and EU legal framing ship last for them.
Chosen by the user over pure QA and red-teaming. See docs/THREE-PS.md.

## 2026-09-19 — Hybrid judge-model funding
Trial runs use a free-tier provider key held by us; paid workspaces must supply their
own model API key, encrypted at rest. Keeps our marginal cost at EUR 0 at any scale
while removing onboarding friction from the first run. Costs us an extra onboarding
state to build and test. Chosen by the user over pure BYOK and pure free-tier.

## 2026-09-19 — Stack: Next.js 16 + Supabase (Frankfurt) + Vercel, all free tiers
Scaffolded Next.js 16.3.5 / React 19 / Tailwind 4 / TypeScript. Supabase gives
Postgres + auth + RLS multi-tenancy in eu-central-1, which doubles as a selling
point. Nothing in the stack bills us at our volume. Vercel Hobby for hosting.

## 2026-09-19 — Project folder name cannot be an npm package name
"Project Novera" has a space and a capital, so create-next-app refused it. The app
was scaffolded elsewhere as "novera" and moved into this folder. package.json name
is "novera"; the directory name is cosmetic.

## 2026-09-19 — Next.js 16 differs from training data
node_modules/next/dist/docs/ holds the authoritative guides and AGENTS.md instructs
reading them before writing route handlers, server actions or caching code. Read the
relevant guide rather than relying on recalled Next.js conventions.

## 2026-09-19 — Tests run on Node's native type stripping, no test framework
`npm test` = `node --test "tests/*.test.ts"`. Zero dependencies, zero config, and it
keeps the evidence logic (coverage arithmetic, run comparison, report hashing,
leak guard) under test from the start.
Constraint this imposes: strip-only mode rejects TypeScript that needs code
generation — **no parameter properties** (`constructor(readonly x: string)`), no
`enum`, no `namespace`. Hit this immediately in LeakError. Relative imports inside
tested modules use explicit `.ts` extensions.

## 2026-09-19 — Evidence integrity enforced in the database, not just in code
`policies`, `run_cases` and `probes` carry triggers that refuse UPDATE and DELETE;
`reports` allows only `revoked_at` / `expires_at` to change. The service role bypasses
RLS but not triggers, so a bug in our own server code cannot rewrite history. For a
product whose value is that its output can be trusted, this belongs below the
application. See supabase/migrations/0001_init.sql.

## 2026-09-19 — Judge verdicts are parsed defensively; an unreadable verdict is an error
The judge returns a JSON object. The parser recovers it from code fences and
surrounding prose, but refuses anything without both a valid verdict and a rationale.
A judge call that fails, or a reply that cannot be read, produces `status: "error"` —
never a pass and never a fail. Grader failure is not agent failure, and must not
enter the score. Anthropic structured outputs (`output_config.format`) would be
stricter but are provider-specific; one parser covers all three providers today.

## 2026-09-19 — Three providers behind one chat interface
Anthropic (official SDK, default `claude-opus-5`), Google (REST, funds trial runs
from its free tier), and any OpenAI-compatible `/v1/chat/completions` endpoint. Model
ids are always configuration, never hard-coded, so a provider changing its free-tier
line-up is an env edit. The same interface serves both the judge and the `model`
agent adapter, so a customer whose "agent" is just a system prompt can be tested too.

## 2026-09-19 — HTTP agent bodies are built as objects, not string templates
`fillTemplate` walks the parsed template and substitutes values before serialisation,
so a policy containing quotes, newlines or backslashes cannot corrupt the request.
Every HTTP failure mode returns `ok: false` with a reason instead of throwing.

## 2026-09-19 — The runner never lets one case end a run, and never grades an absence
`executeRun` records a failed agent call as `error` and moves on, so a dead endpoint
on case 3 still yields evidence for the other 13. When the agent returned nothing,
the judge is not called at all — grading an absence is how a broken integration turns
into a plausible-looking verdict. Persistence sits behind a `RunStore` interface, so
the run logic is tested without a database.

## 2026-09-19 — The client report is built by inclusion, not by stripping
`buildReport` reads only the fields a recipient may see; the agent's raw responses,
the policy text, the system prompt and internal ids are never read. `assertPublishable`
then fails the build if any of them appear anyway. Findings carry the judge's
rationale rather than the conversation.

## 2026-09-19 — A deliberately flawed local fixture stands in for a customer agent
`src/app/api/test-agent/route.ts` is a scripted support agent with planted failures
(executes deletion without verification, adopts injected instructions, treats a claim
of seniority as authentication, reissues a refund blind, invents a discount, confirms
an undocumented feature). It lets us prove the pipeline end to end without a real
customer agent. It carries `fixture: true` and a notice in every response, and refuses
to run when NODE_ENV is production, so it can never be shown as a real result.

## 2026-09-19 — tsconfig: allowImportingTsExtensions
Node's type stripping needs explicit `.ts` in relative imports; TypeScript rejects
that unless this flag is on (it requires noEmit, which Next already sets). Turbopack
resolves the explicit extensions without complaint — verified by `npm run build`.
