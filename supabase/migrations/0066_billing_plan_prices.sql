-- The approved plan catalog (David, 2026-10-12; docs/BILLING-DECISIONS.md §2).
--
--   Team BYOK   EUR 99 a month   unlimited runs on the workspace's own model key; no runs
--                                graded on Novera's keys.
--   Agency Pro  EUR 299 a month  unlimited runs on the workspace's own model key, and 100 runs
--                                a billing period graded on Novera's keys ("managed" runs).
--   Trial       free             3 runs on Novera's keys per account owner (0049/0055; no row).
--
-- 0060 said plans carry no price because none was decided. They now carry the approved list
-- price, which the billing page shows and checkout compares with Stripe's own price before
-- selling: a Stripe price that differs is refused (src/lib/billing/checkout.ts). Stripe stays
-- the price that is charged; this row is the price that was approved.
--
-- Status stays 'draft': sellable in a Stripe sandbox only. Selling live still needs the live
-- checklist (BILLING-DECISIONS §7) and a migration that adds an approved status.
--
-- `runs_per_period` keeps its 0060 meaning for any reader of it, now the managed allowance:
-- null where a plan grants no runs on Novera's keys (its check allows only > 0).

alter table billing_plans add column if not exists monthly_price_cents integer
  check (monthly_price_cents is null or monthly_price_cents > 0);
alter table billing_plans add column if not exists currency text
  check (currency is null or currency ~ '^[a-z]{3}$');
alter table billing_plans add column if not exists managed_runs_per_period integer
  check (managed_runs_per_period is null or managed_runs_per_period >= 0);

update billing_plans set
  name = 'Team BYOK', monthly_price_cents = 9900, currency = 'eur',
  managed_runs_per_period = 0, runs_per_period = null,
  note = 'Approved 2026-10-12: EUR 99 a month; unlimited runs on the workspace''s own model key; no runs on Novera''s keys. Draft until live activation.'
where key = 'team_byok';

update billing_plans set
  name = 'Agency Pro', monthly_price_cents = 29900, currency = 'eur',
  managed_runs_per_period = 100, runs_per_period = 100,
  note = 'Approved 2026-10-12: EUR 299 a month; unlimited runs on the workspace''s own model key and 100 a period on Novera''s keys. Draft until live activation.'
where key = 'agency_pro';

comment on table billing_plans is
  'Plan keys the billing code may map a Stripe price to, with the approved list price (0066). Draft or disabled only: no row can be sold live. Stripe holds the charged price; checkout refuses one that differs from this row''s.';
