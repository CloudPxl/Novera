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

All of it lives in `src/app/globals.css`. Operator dark mode keeps its own values under
`.theme-operator`; the client report is always light.
