# Visual direction

*Decided 2026-09-26, Phase 7. Revisit when the buyer changes, not when the fashion does.*

## What was looked at

Live pages, 1280×800, light mode, measured with computed styles rather than eyeballed.

| Site | Buyer it speaks to | Ground | Headline | Accent | Primary button | Blurred nav |
|---|---|---|---|---|---|---|
| vanta.com | governance / risk | white | serif, 88px, weight 300, −3% tracking | one violet | pill | no |
| braintrust.dev | AI-agent teams | white | sans (Inter), 60px, weight 400 | one blue | pill | no |
| promptfoo.dev | QA / red team | near-white | sans, 64px, weight 900 | one red | 6px radius | no |
| credo.ai | enterprise governance | dark hero | sans, 56px, weight 500 | violet | — | no |
| langchain.com/langsmith | agent teams | dark | — | — | — | no |

What the clear ones share: a white or near-white ground; one idea per screen above the
fold; the product itself (a real UI or artifact) within the first scroll; factual proof
statements ("156 of the Fortune 500 use…") rather than adjectives; a secondary action in
a quiet grey. Credo's first screen was a full consent modal over a dark hero — the one
page where it took effort to learn what the product is.

## What Novera takes, and what it deliberately does not

- **Warm white, not blue-white.** The ground is a warm off-white (`#faf9f7`) with pure
  white panels; ink is warm near-black. It reads as paper — right for a product whose
  centre is a document someone files.
- **No brand accent colour.** Every reference spends one saturated hue on its buttons.
  In Novera, hue already means something: green passed, red failed, amber produced no
  result. A blue or red brand button would sit beside a verdict and read as one. Actions
  are ink; colour is reserved for evidence.
- **Glass only where content scrolls under it.** None of the five uses a blurred
  navigation bar, and glass lowers the contrast of whatever is behind it — unacceptable
  for evidence tables. The sticky top bar is the single exception: mostly opaque (≥ 85%),
  lightly blurred, so a long run page keeps its context while scrolling.
- **Motion is feedback, not decoration.** 150ms ease-out on hover and press, the
  existing reveal under `prefers-reduced-motion`. No parallax, no ambient animation, no
  gradients or glows implying a certainty the evidence may not support.
- **Incomplete evidence is drawn as loudly as a result.** `INCOMPLETE`, `WITHHELD`, no
  result and not corroborated get the same size, weight and position as a grade — a
  quiet grey footnote for missing evidence is how a partial run passes for a clean one.
- **Test data looks like test data.** A fixture is labelled in the same visual weight as
  the thing it could be mistaken for; polish is never applied to make it look real.

## Tokens

All of it lives in `src/app/globals.css`. One light theme everywhere — white panels on a
faint warm-white ground. An operator dark mode existed briefly and was removed at the
user's request (2026-09-26): signed-in pages turning dark beside a white home page read
as two different products.

## The 2026-10-02 redesign: Swiss editorial assurance + evidence instrument

**Why.** Measured at 1440: the home page was a 1024 px text column and the dashboard a
896 px column inside a 1200 px shell — Novera read as an article, and a smaller product
than it is. The report preview was a passive picture of a document.

**What was looked at** (fetched 2026-10-02): Superdesign's SaaS library — its one useful
constraint is *show the real product or an interactive demo, never an abstract blob*;
21st.dev's landing components (feature tab switchers, how-it-works timelines, bento
grids — taken as patterns, not code); Braintrust (alternating text + product rows);
Vanta (an animated product mock in the hero). Declined from all of them: logo walls and
testimonials (we have none, and inventing them is the first dishonest thing on a page),
certification badge grids (we certify nothing), pricing (not decided), purple-blue
gradients, glow blobs, particles and dark-mode-for-fashion.

**The system.**
- *Composition.* `wrap` (1280) and `wrap-wide` (1440) frames with 16/24/40 px gutters;
  text held to `measure` (62ch) inside them. Asymmetric 5:7 / 6:7 columns, full-width
  paper bands (`bg-paper`) for process sections, numbered section heads (`01 ——`) with
  the lede beside the heading on wide screens.
- *Type.* Geist and JetBrains Mono kept — one face across the public page and the app.
  The public page gets a larger voice (`type-display`, `type-section`, `type-lede`); mono
  `type-eyebrow` carries section numbers, versions, hashes and evidence ids.
- *Colour.* The warm neutral ground is unchanged. One accent, `trace` (the existing
  live/info hue), means *evidence moving or selected* — an active trace stage, a selected
  cell, a run in flight — never a button. Verdict colours stay reserved for verdicts.
  Blueprint grid lines (`bg-blueprint`) sit behind the hero and the closing CTA only;
  they are static.
- *Motion.* Four durations (140/220/420/700 ms), two curves, transform and opacity
  only. The vocabulary: line draw, node pop, staggered rise, cell flip, drawer, hash
  scan, refusal nudge, card lift, press. Every animated thing is server-rendered in its
  finished state; motion replays how the state was reached. `useMotion()` reads the
  system setting through `useSyncExternalStore` (server snapshot: still), and the hero
  preview offers its own "Pause motion" switch. Nothing loops. Reveal hides content only
  under `@media (scripting: enabled)` — with JavaScript off every block used to stay at
  opacity 0.
- *Truth.* Every product picture on the public page is labelled illustrative, and its
  figures follow the product's real rules (no letter beside a missing verdict, read-back
  contradictions settled without a model, no-verdict cases named and never counted). The
  tamper module hashes with real SHA-256 in the browser.

## The 2026-10-02 information architecture: calm control over complex evidence

**Why.** Every page showed everything at once — the Overview held ten containers (a next-step
card, five tiles, four attention rows, agent cards, a findings column, runs, an upgrade card, a
guide); a run page put a fourteen-line readiness checklist, ten category cards, a 49-row table and
a comparison on one screen. Polished, and crowded.

**Three levels, never mixed on one screen.**
- *Decide* — page header (where, what, one primary action), one health sentence, three metrics,
  at most five attention items, five recent rows. The Overview and every list page.
- *Investigate* — filters, lenses, comparisons, finding summaries. Review, a run's cases.
- *Prove* — a case's evidence chain, model provenance, hashes, policy passages, audit detail.
  Behind a tab, a dedicated page or an explicit disclosure; never on a Level-1 page.

**Primitives** (`src/components/ui/page.tsx`): `PageHeader`, `Section` + `ViewAll`, `Panel` +
`Rows` (one border per group, dividers between rows — not a card per row), `Metrics` (three or
four figures, each optionally one link), `AttentionList` (five at most, tone as a word and a dot),
`HealthLine`, `TabNav` (tabs as addresses, rendered on the server), `Disclosure` (one level).

**Navigation by account mode.** Personal: Overview · My agent · My runs · My reports · Settings.
Agency: Overview · Work (Review, Runs, Regressions) · Reports · Library (Agents, Scenarios) ·
Settings. Enterprise adds Workspaces and Audit. Every existing URL still resolves. The bar's run
control is quiet (outlined) so a page's own primary action is the only filled button on it.

**Without JavaScript.** A signed-in page streams inside a Suspense boundary that only a script
swaps in; with scripting off it stayed on "Loading…". The streamed block is shown and the fallback
hidden under `@media (scripting: none)`, inside the base layer (Tailwind's `[hidden]` rule is
`!important` there).

**Motion inside the app (2026-10-03).** Sections appear in place in the operator app — no fade on
scroll — because a work tool's screens are read, not toured. Drawers, tabs, progress, live status and
the public page keep their motion. `[data-shell="app"]` in `globals.css`.
