/**
 * Fair use, for every plan — the unlimited ones included. Mirrored by 0067's
 * `runs_fair_use_and_funding()`, which counts both under a per-workspace lock, so concurrent
 * starts cannot pass them; tests/billing.test.ts holds the two together.
 *
 * "Unlimited runs on your own key" means no allowance is counted, not that a runaway CI loop
 * may start twenty thousand runs: the ceiling stops it with a sentence, and support raises it
 * for a workspace that needs more.
 */
export const MAX_RUNS_IN_FLIGHT = 3;
export const FAIR_USE_RUNS = 1_000;
export const FAIR_USE_WINDOW_DAYS = 30;

export const CONCURRENCY_REFUSAL =
  `This workspace already has ${MAX_RUNS_IN_FLIGHT} runs in progress, the most that run at once. Start this one when one of them finishes, or stop one from its run page.`;

export const FAIR_USE_REFUSAL =
  `Fair-use threshold reached: this workspace has started ${FAIR_USE_RUNS.toLocaleString("en-GB")} runs in the last ${FAIR_USE_WINDOW_DAYS} days. Contact support to raise the limit; every run and report already here stays readable.`;
