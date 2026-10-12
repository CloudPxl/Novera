-- Billing gates runs (decision D3, David, 2026-10-12; docs/BILLING-DECISIONS.md).
--
-- The free tier is the trial: three runs per account owner (0049/0055). After it, a run needs
-- something that pays for it: a subscription (Team BYOK or Agency Pro) or a manual grant.
-- `startRun` decides which, from the same rows the billing page reads; this migration holds the
-- parts that must survive concurrent starts and the service role:
--
--   1. A run names what funds it. `funded_by_subscription` (a Stripe subscription id) or
--      `funded_by_grant` (a billing_entitlement_grants id), or neither for a trial run. Both are
--      frozen with the run's other attribution, and must belong to the run's workspace.
--   2. `judge_source = 'plan_managed'`: graded on Novera's keys under a plan or grant, not under
--      the trial. A report states who funded the grading, and "the trial" would be false for a
--      paying workspace. Such a run must name its funding; under a subscription it counts against
--      that plan's managed allowance for the current period (Agency Pro: 100), counted here under
--      a lock, so concurrent starts cannot exceed it.
--   3. A grant with a run allowance is counted here too, under the same lock.
--   4. Fair use, for every plan including the unlimited ones: at most 3 runs in flight (queued or
--      running) per workspace, and at most 1,000 runs per workspace in any 30 days. A runaway CI
--      loop stops at the ceiling with a sentence instead of running up 20,000 runs.
--
-- The numbers are mirrored by src/lib/billing/limits.ts; tests/billing.test.ts holds them
-- together. The trial cap (0055) is unchanged and still counted under its own per-owner lock.
--
-- Lock order: this trigger takes the per-workspace lock; runs_trial_cap (fired after it, triggers
-- run in name order) takes the per-owner lock. Every insert takes them in that order.
--
-- No new table, so no new erasure path: the columns leave with their runs in erase_workspace().
-- Not foreign keys on purpose: erasure removes grants and subscriptions in its own order, and the
-- check below is what ties them to the workspace.

alter table runs drop constraint if exists runs_judge_source_check;
alter table runs add constraint runs_judge_source_check
  check (judge_source in ('trial_free', 'workspace_key', 'plan_managed'));

alter table runs add column if not exists funded_by_subscription text
  check (funded_by_subscription is null or funded_by_subscription ~ '^sub_[A-Za-z0-9]{1,64}$');
alter table runs add column if not exists funded_by_grant uuid;
alter table runs add constraint runs_funded_once
  check (funded_by_subscription is null or funded_by_grant is null);

comment on column runs.funded_by_subscription is
  'The Stripe subscription that funded this run (0067). Null for a trial or grant-funded run. Frozen.';
comment on column runs.funded_by_grant is
  'The manual grant that funded this run (0067). Null for a trial or subscription-funded run. Frozen.';

create or replace function runs_fair_use_and_funding()
returns trigger language plpgsql as $$
declare
  in_flight integer;
  recent    integer;
  sub       billing_subscriptions;
  g         billing_entitlement_grants;
  allowance integer;
  used      integer;
begin
  perform pg_advisory_xact_lock(hashtext('novera:run-start'), hashtext(new.workspace_id::text));

  -- Fair use. Counted after the lock, so of several starts at once only those under the ceiling
  -- are written.
  select count(*) into in_flight from runs
   where workspace_id = new.workspace_id and status in ('queued', 'running');
  if in_flight >= 3 then
    raise exception 'concurrent_runs_limit: workspace % already has % runs in progress', new.workspace_id, in_flight;
  end if;
  select count(*) into recent from runs
   where workspace_id = new.workspace_id and created_at > now() - interval '30 days';
  if recent >= 1000 then
    raise exception 'fair_use_limit: workspace % started % runs in the last 30 days', new.workspace_id, recent;
  end if;

  if new.funded_by_subscription is not null then
    select * into sub from billing_subscriptions where stripe_subscription_id = new.funded_by_subscription;
    if not found or sub.workspace_id <> new.workspace_id or sub.plan_key is null
       or sub.status not in ('active', 'trialing', 'past_due') then
      raise exception 'run_not_funded: subscription % does not fund runs in workspace %', new.funded_by_subscription, new.workspace_id;
    end if;
  end if;

  if new.funded_by_grant is not null then
    select * into g from billing_entitlement_grants where id = new.funded_by_grant;
    if not found or g.workspace_id <> new.workspace_id or g.revoked_at is not null
       or g.starts_at > now() or (g.ends_at is not null and g.ends_at <= now()) then
      raise exception 'run_not_funded: grant % is not in force for workspace %', new.funded_by_grant, new.workspace_id;
    end if;
    if g.runs_allowed is not null then
      select count(*) into used from runs
       where workspace_id = new.workspace_id and created_at >= g.starts_at
         and (g.ends_at is null or created_at < g.ends_at);
      if used >= g.runs_allowed then
        raise exception 'grant_exhausted: grant % allows % runs and % have started', g.id, g.runs_allowed, used;
      end if;
    end if;
  end if;

  if new.judge_source = 'plan_managed' then
    if new.funded_by_subscription is null and new.funded_by_grant is null then
      raise exception 'run_not_funded: a run graded on Novera''s keys outside the trial must name the plan or grant that funds it';
    end if;
    if new.funded_by_subscription is not null then
      select managed_runs_per_period into allowance from billing_plans where key = sub.plan_key;
      if coalesce(allowance, 0) <= 0 then
        raise exception 'run_not_funded: plan % includes no runs graded on Novera''s keys', sub.plan_key;
      end if;
      select count(*) into used from runs
       where funded_by_subscription = new.funded_by_subscription and judge_source = 'plan_managed'
         and (sub.current_period_start is null or created_at >= sub.current_period_start);
      if used >= allowance then
        raise exception 'managed_allowance_exhausted: % of % managed runs used this period', used, allowance;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists runs_fair_use_and_funding on runs;
create trigger runs_fair_use_and_funding before insert on runs
  for each row execute function runs_fair_use_and_funding();

-- Who funded a run is a fact about the past, like who started it (0036).
create or replace function freeze_run_attribution() returns trigger
language plpgsql as $$
begin
  if new.created_by is distinct from old.created_by
  or new.api_key_id is distinct from old.api_key_id
  or new.schedule_id is distinct from old.schedule_id
  or new.funded_by_subscription is distinct from old.funded_by_subscription
  or new.funded_by_grant is distinct from old.funded_by_grant
  or new.judge_source is distinct from old.judge_source then
    raise exception 'Who started or funded a run cannot be changed after the run exists';
  end if;
  return new;
end;
$$;

-- Plan-managed runs grade on Novera's shared keys, like the trial, so they share its grading
-- slots (0041/0047): a paying workspace's runs do not get to degrade everyone's verdicts either.
create or replace function claim_run_slice_fenced(target uuid, ws uuid, lease_ms integer, trial_slots integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r runs;
  token uuid := gen_random_uuid();
begin
  select * into r from runs where id = target and workspace_id = ws;
  if not found or r.status not in ('queued', 'running') then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if r.judge_source in ('trial_free', 'plan_managed') then
    perform pg_advisory_xact_lock(hashtext('novera:trial-grading'));
    if (select count(*) from runs
         where judge_source in ('trial_free', 'plan_managed') and id <> target
           and status in ('queued', 'running') and lease_until > now()) >= trial_slots then
      return jsonb_build_object('outcome', 'busy');
    end if;
  end if;

  update runs
     set status = 'running',
         lease_until = now() + make_interval(secs => lease_ms / 1000.0),
         lease_token = token
   where id = target and workspace_id = ws
     and status in ('queued', 'running')
     and (lease_until is null or lease_until < now());
  if not found then
    return jsonb_build_object('outcome', 'held');
  end if;
  return jsonb_build_object('outcome', 'claimed', 'lease_token', token);
end;
$$;

revoke execute on function claim_run_slice_fenced(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function claim_run_slice_fenced(uuid, uuid, integer, integer) to service_role;
