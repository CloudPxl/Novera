-- One Stripe customer per workspace *per Stripe mode*, not one per workspace.
--
-- Preview and production share this database. Under 0060 a workspace that ran a sandbox checkout
-- kept its test-mode customer forever (the table is frozen), so it could never buy in live mode:
-- the only customer it could have was the wrong mode's. Keying the mapping on (workspace_id,
-- livemode) lets a workspace hold one of each, and the readers (src/lib/billing) read only the
-- configured mode's rows, so sandbox rows never show, never block erasure and never block a
-- live checkout.
--
-- Nothing else changes: stripe_customer_id stays unique (subscriptions reference it), the rows
-- stay frozen, and erase_workspace() already deletes by workspace_id.

alter table billing_customers drop constraint if exists billing_customers_pkey;
alter table billing_customers add constraint billing_customers_pkey primary key (workspace_id, livemode);

comment on table billing_customers is
  'One Stripe customer per workspace per Stripe mode (0065), frozen once written. The only link from a Stripe object to a workspace that the webhook trusts.';
