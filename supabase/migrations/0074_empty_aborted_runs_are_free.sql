-- A run that ended before it recorded any scenario costs nothing (decision 2026-10-17, David;
-- docs/BILLING-DECISIONS.md).
--
-- A run stopped by a person, superseded by a newer commit (ci_triggers, 0070), ended by a slice
-- failure before its first scenario, or stopped by the idle sweep (0040) before anything was
-- recorded never reached the customer's agent and produced no evidence. Until now it still used
-- one of the trial's three runs, a unit of a grant, or a plan's managed allowance, because every
-- allowance counted every run row. A pipeline pushing three commits in a minute spent two runs
-- on nothing.
--
-- The rule, the same in every allowance count below and in `counts_against_allowance(runs)`:
--
--   a run counts unless  status = 'aborted'
--                        and not exists (select 1 from run_cases where run_id = runs.id)
--
-- So a run counts while it is queued or running (it holds its place while it can still execute,
-- which is what keeps twelve racing starts at three), once it is completed, and once it is
-- aborted with at least one recorded scenario. A run halted after three transport failures has
-- recorded those failures as case errors (src/lib/runner/execute.ts saves each before counting
-- it), so it reached the agent and counts. A scenario in flight when Stop lands is still saved
-- (0043 lets an aborted run take rows), and from then on the run counts.
--
-- What changes is the counting, never the rows: runs, their status and their frozen funding
-- (0067) stay exactly as they were, append-only. A run counted when it started and freed when it
-- was aborted empty lets a new start through afterwards; that is intended.
--
-- What does not change: fair use (3 in flight, 1,000 per 30 days) counts every start. It is a
-- rate and abuse limit, not an allowance, and a loop that starts and stops runs still meets it.
-- The locks are unchanged: runs_fair_use_and_funding takes the per-workspace lock first, then
-- runs_trial_cap the per-owner lock (triggers fire in name order), and each count runs after its
-- lock, so concurrent starts cannot pass any ceiling.
--
-- Mirrored by the application: `workspaceEntitlement` (trial) and `loadBillingRows` (grant and
-- managed windows) filter on the computed column below, so the badge, Settings, Billing, the
-- dashboard and every refusal show the same numbers the database enforces.
-- tests/allowance-empty-abort.test.ts holds the SQL and the TypeScript rule together.
--
-- No new table, so no new erasure path.

-- The rule as a computed column (PostgREST: `runs?counts_against_allowance=is.true`). Invoker's
-- rights: a caller sees run_cases exactly where it sees the run.
create or replace function counts_against_allowance(r runs)
returns boolean language sql stable as $$
  select not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id))
$$;
comment on function counts_against_allowance(runs) is
  'Whether a run uses an allowance (trial, grant, managed): false only for a run aborted before it recorded any scenario (0074). Fair use counts every run regardless.';
grant execute on function counts_against_allowance(runs) to authenticated, service_role;

-- The trial: three runs per account owner across every workspace they own (0055), under the
-- per-owner lock.
create or replace function runs_trial_cap()
returns trigger language plpgsql as $$
declare
  used integer;
  owner uuid;
begin
  if new.judge_source = 'trial_free' then
    select owner_id into owner from workspaces where id = new.workspace_id;
    perform pg_advisory_xact_lock(hashtext('novera:trial-cap'), hashtext(owner::text));
    select count(*) into used from runs r join workspaces w on w.id = r.workspace_id
     where w.owner_id = owner
       and not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id));
    if used >= 3 then
      raise exception 'trial_exhausted: the trial covers 3 runs per account and the owner of workspace % has used them', new.workspace_id;
    end if;
  end if;
  return new;
end;
$$;

-- Funding and fair use (0067), under the per-workspace lock. Fair use counts every run; a grant's
-- units and a plan's managed allowance count only runs that are not aborted-empty.
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
  -- are written. Every start counts here, an empty aborted one included (0074).
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
      select count(*) into used from runs r
       where r.workspace_id = new.workspace_id and r.created_at >= g.starts_at
         and (g.ends_at is null or r.created_at < g.ends_at)
         and not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id));
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
      select count(*) into used from runs r
       where r.funded_by_subscription = new.funded_by_subscription and r.judge_source = 'plan_managed'
         and (sub.current_period_start is null or r.created_at >= sub.current_period_start)
         and not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id));
      if used >= allowance then
        raise exception 'managed_allowance_exhausted: % of % managed runs used this period', used, allowance;
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- The triggers themselves are unchanged (0049/0055: runs_trial_cap; 0067: runs_fair_use_and_funding),
-- both before insert on runs; `create or replace` keeps them bound to the new bodies.

notify pgrst, 'reload schema';
