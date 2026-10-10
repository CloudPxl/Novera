# A third, independent grading vendor

**Status:** blocked on a funded key. Reviewed 2026-10-10. The code path exists and is off: no
`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is configured, and `DEFAULT_ROUTES` names neither.

## What counts as independent

A verdict is two models from different vendors agreeing. `src/lib/judge/independence.ts` takes
the vendor from the connection name, which is the serving vendor, not the model's lineage.

| Candidate | Independent of what grades today? | Why |
|---|---|---|
| Anthropic direct (`claude-haiku-4-5`) | **Yes, recommended** | A new model lineage beside OpenAI-trained gpt-oss (on Groq) and Mistral's ministral |
| OpenAI direct | Partly | Different serving stack, but OpenAI trained gpt-oss, which grades first today: a plausible shared blind spot the label would not show |
| OpenRouter aliases | **No** | The same base models counted twice, under a different connection name. OpenRouter's data ceiling is also `synthetic`, so it is refused judge prompts anyway |

**Which model:** every grading call sends `temperature: 0`. Among current Claude models, only
Haiku 4.5 accepts it; Opus 5.5, Opus 5, Opus 4.8, Opus 4.7 and Sonnet 5 reject sampling
parameters. `DEFAULT_ANTHROPIC_MODEL` now names Haiku 4.5.

**Cost:** measured judge calls take about 480 input and 90–320 output tokens. That is roughly
$0.001–0.002 per vote on Haiku 4.5.

## Data class (decision for David)

`src/lib/privacy/data-class.ts` already sets `anthropic` and `openai` to `identifiable_customer`.
These terms, read 2026-10-10, support that:

- **Anthropic Commercial Terms** (effective 2025-06-17), https://www.anthropic.com/legal/commercial-terms: "Anthropic may not train models on Customer Content from Services."
- **Anthropic DPA** (effective 2025-02-24), https://www.anthropic.com/legal/data-processing-addendum: Anthropic acts as processor, and EU SCCs (Module Two and Three) are incorporated.
- **Training:** https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training: commercial API inputs are not used for training by default.
- **Retention:** https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data: API data is deleted within 30 days.
- **OpenAI:** https://developers.openai.com/api/docs/guides/your-data: no training on API data unless you opt in; abuse logs are kept up to 30 days; EU data residency is a per-project setting. **The OpenAI DPA was not readable from here (HTTP 403); read it by hand.**

Two choices:

- **Keep `identifiable_customer`.** Anthropic is a US processor under SCCs, and inference is not in the EU by default.
- **Set `redacted_customer`** until a DPA is countersigned or zero data retention is agreed.

Either way, record it as a dated DECISIONS entry citing the URLs above.

## Steps, once a funded key exists

1. Add one env line, `ANTHROPIC_API_KEY=…`, to `.env.local` and to Vercel (Production).
2. `npm run verify:models` checks the key answers and notes it is in no route yet.
3. Calibrate:
   ```
   CALIBRATE_SUITE=eu-support-v5 CALIBRATE_MODELS="anthropic/claude-haiku-4-5" npm run calibrate
   ```
   This is about 44 calls, roughly $0.10. A full suite stores a row; a `CALIBRATE_CASES` subset is never stored.
4. Place the model in `DEFAULT_ROUTES` by measured false passes only. Re-calibrate the new order and write the DECISIONS entry.

## Known gaps before routing it

- `anthropic.ts` uses the SDK, which reads the whole response body, so the 1 MB answer cap does not hold on this path.
- `vendorOf` could become lineage-aware, so an OpenRouter alias could never be printed as independent corroboration.

`maxRetries: 0` is already set (2026-10-10), so the router sees every 429.

## Measurement the route order rests on (2026-10-09, local copy)

**Suite:** eu-support v5, 44 labelled cases, rubric `95ad35dbe4bc`, temperature 0, every model reading the same fixture evidence.

| Model | Agreed | False passes | False fails | Errors |
|---|---|---|---|---|
| groq/openai/gpt-oss-20b | 43/44 | 0 | 0 | 1 (network) |
| mistral/ministral-8b-latest | 42/44 | 0 | 2 (T07, T49) | 0 |
| groq/openai/gpt-oss-120b | 44/44 | 0 | 0 | 0 |
| mistral/ministral-3b-latest | 44/44 | 0 | 0 | 0 |
| mistral/ministral-14b-latest | 43/44 | 0 | 1 (T07) | 0 |

The T08 false passes of 2026-09-24 did not reproduce: 4 of 4 runs per model were correct.

The order is unchanged. False passes are tied at zero, and one clean day does not outweigh T08's
history.

**Caveat:** the calibration harness sends a scenario's input but not `earlier_turns`, so T43 was
graded on its final turn alone.
