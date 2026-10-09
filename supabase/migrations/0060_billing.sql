-- Billing: Stripe, sandbox first (Phase 3, docs/BILLING-DECISIONS.md).
--
-- What Novera keeps about money is the least that lets it answer one question from its own
-- rows: what may this workspace do right now, and why. Stripe is the system of record for
-- customers, payment methods, invoices and receipts; nothing here holds a card, an address,
-- an email, an invoice, a webhook payload or a Stripe secret.
--
--   billing_plans                 the plan keys the code's catalog names. Draft or disabled
--                                 only: no row here can be sold. Approving a plan is a later
--                                 migration David signs off, not a dashboard toggle.
--   billing_customers             workspace <-> Stripe customer, one each, frozen once written.
--   billing_subscriptions         the subscription's current state, written only from Stripe's
--                                 own object; never from a browser's return URL.
--   billing_subscription_history  every state written above, append-only.
--   billing_entitlement_grants    manual grants (pilots, support, internal), naming who and why;
--                                 revocable once, never edited.
--   billing_webhook_events        one row per Stripe event id: the idempotency ledger.
--   billing_events                the billing audit trail, append-only.
--
-- Clients write none of these (0057's lesson): no INSERT/UPDATE/DELETE grant for anon or
-- authenticated, and no write policy. The server writes with the service role after its own
-- role check (`billing.manage`), and the triggers below hold even against the service role.
-- Every table leaves with its workspace through erase_workspace(); a subscription change
-- never deletes a run, a case, a report or any other evidence.

-- ------------------------------------------------------------------ plans
create table if not exists billing_plans (
  key             text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name            text not null check (char_length(name) between 1 and 80),
  -- Runs a workspace on this plan may start per billing period. Null = no run allowance stated.
  runs_per_period integer check (runs_per_period is null or runs_per_period > 0),
  -- 'draft': usable in a Stripe sandbox only. 'disabled': not offered anywhere. There is no
  -- third value on purpose: a sellable plan needs a migration that adds one.
  status          text not null default 'draft' check (status in ('draft', 'disabled')),
  note            text,
  created_at      timestamptz not null default now()
);
comment on table billing_plans is
  'Plan keys the billing code may map a Stripe price to. Draft or disabled only; no price, no currency: prices live in Stripe and are undecided (docs/BILLING-DECISIONS.md).';

-- Placeholders, mirrored by PLAN_CATALOG in src/lib/billing/plans.ts (tests/billing.test.ts
-- holds the two together). The allowances are proposals for the sandbox, not decisions.
insert into billing_plans (key, name, runs_per_period, status, note) values
  ('team_byok',   'Team (bring your own model key) — placeholder', 30,  'draft', 'Proposed. Price, allowance and name undecided.'),
  ('agency_pro',  'Agency Pro — placeholder',                     150, 'draft', 'Proposed. Price, allowance and name undecided.')
on conflict (key) do nothing;

alter table billing_plans enable row level security;
-- No policy: read by the server only. Nothing about plans is published.
revoke all on billing_plans from anon, authenticated;

-- ------------------------------------------------------------------ customers
create table if not exists billing_customers (
  workspace_id       uuid primary key references workspaces (id),
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,64}$'),
  livemode           boolean not null,
  -- The member whose action created the customer at Stripe. A plain id, like audit_events.
  created_by         uuid,
  created_at         timestamptz not null default now()
);
comment on table billing_customers is
  'One Stripe customer per workspace, frozen once written. The only link from a Stripe object to a workspace that the webhook trusts.';

drop trigger if exists billing_customers_frozen on billing_customers;
create trigger billing_customers_frozen before update or delete on billing_customers
  for each row execute function refuse_mutation();

-- ------------------------------------------------------------------ subscriptions
create table if not exists billing_subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references workspaces (id),
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,64}$'),
  stripe_customer_id     text not null references billing_customers (stripe_customer_id),
  -- Stripe's status, as Stripe wrote it. Not an enum: Stripe adds values, and an unknown one
  -- must be stored (and grant nothing) rather than fail the event forever.
  status                 text not null check (status ~ '^[a-z_]{1,40}$'),
  -- Null when Stripe's price is not on the server's allow-list: such a subscription grants nothing.
  plan_key               text references billing_plans (key),
  stripe_price_id        text check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]{1,64}$'),
  quantity               integer check (quantity is null or quantity >= 0),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  cancel_at              timestamptz,
  canceled_at            timestamptz,
  ended_at               timestamptz,
  -- When payment first failed in the current delinquency; cleared when it is settled. The
  -- grace period is counted from here (BILLING_GRACE_DAYS).
  delinquent_since       timestamptz,
  livemode               boolean not null,
  stripe_created_at      timestamptz not null,
  -- When the state on this row was true at Stripe: the time it was fetched from Stripe, or the
  -- event's time when it came from the event's own snapshot. Never moves backwards.
  stripe_observed_at     timestamptz not null,
  last_event_id          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists billing_subscriptions_workspace on billing_subscriptions (workspace_id, stripe_created_at desc);

comment on table billing_subscriptions is
  'Current state of each Stripe subscription, written by the webhook from Stripe''s object. Out-of-order safe: stripe_observed_at never moves backwards and canceled is terminal, enforced here.';

create or replace function billing_subscriptions_guard()
returns trigger language plpgsql as $$
declare
  owner uuid;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'A subscription record is never deleted; it leaves with its workspace.';
  end if;

  -- The customer named must be this workspace's customer, for the service role too.
  select workspace_id into owner from billing_customers where stripe_customer_id = new.stripe_customer_id;
  if owner is distinct from new.workspace_id then
    raise exception 'billing_subscriptions.stripe_customer_id must belong to the same workspace'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.livemode is distinct from old.livemode
       or new.stripe_created_at is distinct from old.stripe_created_at
       or new.created_at is distinct from old.created_at then
      raise exception 'A subscription''s workspace, Stripe ids, mode and creation time are fixed';
    end if;
    if new.stripe_observed_at < old.stripe_observed_at then
      raise exception 'stale_subscription_state: a subscription state older than the stored one is not written';
    end if;
    if old.status in ('canceled', 'incomplete_expired') and new.status is distinct from old.status then
      raise exception 'terminal_subscription_state: a % subscription does not change status', old.status;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists billing_subscriptions_guard on billing_subscriptions;
create trigger billing_subscriptions_guard before insert or update or delete on billing_subscriptions
  for each row execute function billing_subscriptions_guard();

-- ------------------------------------------------------------------ history
create table if not exists billing_subscription_history (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references workspaces (id),
  stripe_subscription_id text not null,
  status                 text not null,
  plan_key               text,
  stripe_price_id        text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null,
  delinquent_since       timestamptz,
  stripe_observed_at     timestamptz not null,
  stripe_event_id        text,
  recorded_at            timestamptz not null default now()
);
create index if not exists billing_subscription_history_sub on billing_subscription_history (stripe_subscription_id, recorded_at);

drop trigger if exists billing_subscription_history_immutable on billing_subscription_history;
create trigger billing_subscription_history_immutable before update or delete on billing_subscription_history
  for each row execute function refuse_mutation();

-- ------------------------------------------------------------------ manual grants
create table if not exists billing_entitlement_grants (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id),
  kind          text not null check (kind in ('pilot', 'support', 'internal', 'compensation')),
  plan_key      text references billing_plans (key),
  -- Runs the grant allows between starts_at and ends_at. Null (unmetered) only for internal use.
  runs_allowed  integer check (runs_allowed is null or runs_allowed > 0),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  reason        text not null check (char_length(btrim(reason)) between 3 and 500),
  granted_by    uuid not null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,
  check (ends_at is null or ends_at > starts_at),
  check (runs_allowed is not null or kind = 'internal'),
  check ((revoked_at is null) = (revoked_by is null)),
  check (revoked_at is null or char_length(btrim(coalesce(revoke_reason, ''))) between 3 and 500)
);
create index if not exists billing_entitlement_grants_workspace on billing_entitlement_grants (workspace_id, starts_at desc);

comment on table billing_entitlement_grants is
  'Access granted without a payment — a pilot, a support gesture, internal use — naming who granted it and why. Revoked once, never edited.';

create or replace function billing_grants_forward_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'A grant is revoked, not deleted.';
  end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.kind <> old.kind
     or new.plan_key is distinct from old.plan_key or new.runs_allowed is distinct from old.runs_allowed
     or new.starts_at <> old.starts_at or new.ends_at is distinct from old.ends_at
     or new.reason <> old.reason or new.granted_by <> old.granted_by or new.created_at <> old.created_at then
    raise exception 'A grant''s terms are frozen; revoke it and grant again.';
  end if;
  if old.revoked_at is not null then
    raise exception 'A revoked grant stays revoked.';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_grants_forward_only on billing_entitlement_grants;
create trigger billing_grants_forward_only before update or delete on billing_entitlement_grants
  for each row execute function billing_grants_forward_only();

-- ------------------------------------------------------------------ webhook ledger
create table if not exists billing_webhook_events (
  stripe_event_id   text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9]{1,64}$'),
  type              text not null check (char_length(type) between 1 and 100),
  livemode          boolean not null,
  stripe_created_at timestamptz not null,
  -- Set once the event is matched to a workspace. Null for an event that matched none.
  workspace_id      uuid references workspaces (id),
  status            text not null default 'processing'
                    check (status in ('processing', 'processed', 'ignored', 'refused', 'failed')),
  attempts          integer not null default 1 check (attempts >= 1),
  -- A short reason in our words. Never the payload: it carries names, emails and addresses.
  detail            text check (detail is null or char_length(detail) <= 500),
  received_at       timestamptz not null default now(),
  claimed_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index if not exists billing_webhook_events_workspace on billing_webhook_events (workspace_id) where workspace_id is not null;

comment on table billing_webhook_events is
  'One row per Stripe event id. A duplicate delivery finds its row and does nothing; a failed one may be claimed again; a finished one never changes.';

create or replace function billing_webhook_events_forward_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'The webhook ledger is append-only.';
  end if;
  if new.stripe_event_id <> old.stripe_event_id or new.type <> old.type or new.livemode <> old.livemode
     or new.stripe_created_at <> old.stripe_created_at or new.received_at <> old.received_at then
    raise exception 'A webhook event''s identity is fixed';
  end if;
  if old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id then
    raise exception 'A webhook event''s workspace is fixed once matched';
  end if;
  if old.status in ('processed', 'ignored', 'refused') then
    raise exception 'A finished webhook event does not change';
  end if;
  -- failed -> processing (a retry claims it again), processing -> anything.
  if old.status = 'failed' and new.status not in ('failed', 'processing') then
    raise exception 'A failed webhook event is claimed again before it finishes';
  end if;
  if new.attempts < old.attempts then
    raise exception 'Attempts only go up';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_webhook_events_forward_only on billing_webhook_events;
create trigger billing_webhook_events_forward_only before update or delete on billing_webhook_events
  for each row execute function billing_webhook_events_forward_only();

-- ------------------------------------------------------------------ billing audit trail
create table if not exists billing_events (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces (id),
  -- A member or staff id for a person's action; null when Stripe or the system acted.
  actor_id         uuid,
  source           text not null check (source in ('stripe', 'member', 'staff', 'system')),
  action           text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  stripe_event_id  text,
  stripe_object_id text,
  -- Ids, statuses, plan keys and counts. Never an email, an address, an amount owed or a secret.
  detail           jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4000),
  created_at       timestamptz not null default now()
);
create index if not exists billing_events_workspace on billing_events (workspace_id, created_at desc);

drop trigger if exists billing_events_append_only on billing_events;
create trigger billing_events_append_only before update or delete on billing_events
  for each row execute function refuse_mutation();

-- ------------------------------------------------------------------ RLS
alter table billing_customers            enable row level security;
alter table billing_subscriptions        enable row level security;
alter table billing_subscription_history enable row level security;
alter table billing_entitlement_grants   enable row level security;
alter table billing_webhook_events       enable row level security;
alter table billing_events               enable row level security;

-- What the workspace is on, and any grant it holds: every member may read it.
drop policy if exists billing_subscriptions_select on billing_subscriptions;
create policy billing_subscriptions_select on billing_subscriptions for select
  using (is_workspace_member(workspace_id));
drop policy if exists billing_entitlement_grants_select on billing_entitlement_grants;
create policy billing_entitlement_grants_select on billing_entitlement_grants for select
  using (is_workspace_member(workspace_id));

-- The Stripe customer id, the history and the trail: the roles that hold billing.manage.
drop policy if exists billing_customers_select on billing_customers;
create policy billing_customers_select on billing_customers for select
  using (has_workspace_role(workspace_id, array['owner', 'admin']));
drop policy if exists billing_subscription_history_select on billing_subscription_history;
create policy billing_subscription_history_select on billing_subscription_history for select
  using (has_workspace_role(workspace_id, array['owner', 'admin']));
drop policy if exists billing_events_select on billing_events;
create policy billing_events_select on billing_events for select
  using (has_workspace_role(workspace_id, array['owner', 'admin']));
-- billing_webhook_events: no policy. The ledger is the server's.

revoke insert, update, delete, truncate, references, trigger on
  billing_customers, billing_subscriptions, billing_subscription_history,
  billing_entitlement_grants, billing_events
  from anon, authenticated;
revoke all on billing_webhook_events from anon, authenticated;
revoke all on billing_customers, billing_subscriptions, billing_subscription_history,
  billing_entitlement_grants, billing_events, billing_webhook_events, billing_plans from anon;

revoke all on function billing_subscriptions_guard() from public, anon, authenticated;
revoke all on function billing_grants_forward_only() from public, anon, authenticated;
revoke all on function billing_webhook_events_forward_only() from public, anon, authenticated;

-- ------------------------------------------------------------------ erasure
-- 0056's body exactly, plus the billing tables, deleted before the workspace and after the
-- audit trail. The Stripe customer itself is not ours to delete from here: cancelling the
-- subscription at Stripe before erasure is the application's job (docs/BILLING-DECISIONS.md).
create or replace function erase_workspace(target uuid, requested_by uuid default null)
returns erasure_log
language plpgsql
security definer
set search_path = public
as $$
declare
  record erasure_log;
  n_agents integer;
  n_runs integer;
  n_cases integer;
  n_reports integer;
begin
  select count(*) into n_agents from agents where workspace_id = target;
  select count(*) into n_runs from runs where workspace_id = target;
  select count(*) into n_cases from run_cases where workspace_id = target;
  select count(*) into n_reports from reports where workspace_id = target;

  perform set_config('novera.erasing', 'on', true);

  -- 0054's tables first: they reference runs' neighbours only through the workspace.
  delete from assistant_memory_candidates where workspace_id = target;
  delete from assistant_memory      where workspace_id = target;
  delete from assistant_threads     where workspace_id = target;
  delete from workspace_invitations where workspace_id = target;
  delete from audit_events          where workspace_id = target;
  -- A profile pointing here loses the default, not the profile.
  update user_profiles set default_workspace_id = null where default_workspace_id = target;
  update user_profiles set default_agent_id = null
   where default_agent_id in (select id from agents where workspace_id = target);

  -- 0060: billing. Subscriptions before the customer they name.
  delete from billing_events               where workspace_id = target;
  delete from billing_webhook_events       where workspace_id = target;
  delete from billing_subscription_history where workspace_id = target;
  delete from billing_subscriptions        where workspace_id = target;
  delete from billing_entitlement_grants   where workspace_id = target;
  delete from billing_customers            where workspace_id = target;

  -- Before the endpoints they belong to.
  delete from webhook_deliveries    where workspace_id = target;
  delete from webhook_endpoints     where workspace_id = target;
  delete from reports               where workspace_id = target;
  delete from diagnoses             where workspace_id = target;
  delete from case_retests          where workspace_id = target;
  delete from evidence_observations where workspace_id = target;
  -- Before run_cases, which it references.
  delete from verdict_reviews       where workspace_id = target;
  delete from run_cases             where workspace_id = target;
  delete from runs                  where workspace_id = target;
  -- After the runs that name them, before the agents and suites they name.
  delete from run_schedules         where workspace_id = target;
  delete from probes                where workspace_id = target;
  delete from scenario_drafts       where workspace_id = target;
  -- 0056: after the drafts that name them, before the agents and suites they name.
  delete from suite_obligations     where workspace_id = target;
  delete from suite_sources         where workspace_id = target;
  delete from suite_builds          where workspace_id = target;
  -- After the drafts that reference it, before the agents it references.
  delete from production_failures   where workspace_id = target;
  delete from api_keys              where workspace_id = target;
  delete from policies              where workspace_id = target;
  delete from secrets               where workspace_id = target;
  delete from agents                where workspace_id = target;
  delete from suites                where workspace_id = target;
  delete from workspace_members     where workspace_id = target;
  delete from workspaces            where id = target;

  perform set_config('novera.erasing', 'off', true);

  insert into erasure_log (workspace_id, requested_by, agents_removed, runs_removed, cases_removed, reports_removed)
  values (target, requested_by, n_agents, n_runs, n_cases, n_reports)
  returning * into record;

  return record;
end;
$$;

revoke execute on function erase_workspace(uuid, uuid) from public, anon, authenticated;
