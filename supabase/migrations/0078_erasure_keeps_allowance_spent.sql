-- Erasing a workspace no longer gives back what its runs spent (Round 2 audit, 2026-10-19).
--
-- The trial (three runs per owner, 0055/0074) and an owner-wide pilot pool (0076) were counted
-- from run rows that still exist, and erase_workspace deletes a workspace's runs. So an owner
-- could create a workspace, run, erase it and run again on Novera's keys without end: the header
-- read "Trial · 3 left", then 2 after a run, then 3 again once the second workspace was erased.
--
-- Now erase_workspace first writes, for each of the workspace's runs that counted against an
-- allowance (0074's rule, read while its scenarios still exist), one row here: the owner, the run,
-- how it was funded, when. The trial cap and an owner-wide pilot's count add these rows to the
-- runs that still exist, in the database (below) and on screen (`workspaceEntitlement`,
-- `withPoolCounts`). A workspace-scoped grant needs nothing: it is erased with its workspace.
--
-- What a row holds: ids, a funding label and a timestamp. No content, no personal data beyond the
-- owner's user id, which erase_account keeps pseudonymised exactly as it keeps the authorship of
-- evidence elsewhere. It deliberately survives the workspace's erasure — that is its purpose —
-- and is written only by erase_workspace (security definer). Nothing reads it but the server and
-- the two counts; nothing edits or deletes it except erase_account's own erasure of the owner,
-- which leaves the account banned and unable to start a run (so the rows are removed with it).

create table if not exists allowance_spent_by_erased_runs (
  run_id          uuid primary key,
  owner_id        uuid not null,
  workspace_id    uuid not null,
  judge_source    text,
  funded_by_grant uuid,
  run_created_at  timestamptz not null,
  erased_at       timestamptz not null default now()
);
create index if not exists allowance_spent_by_erased_runs_owner on allowance_spent_by_erased_runs (owner_id);
create index if not exists allowance_spent_by_erased_runs_grant on allowance_spent_by_erased_runs (funded_by_grant) where funded_by_grant is not null;

alter table allowance_spent_by_erased_runs enable row level security;
revoke all on allowance_spent_by_erased_runs from anon, authenticated;

create or replace function allowance_spent_frozen()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'allowance_spent_by_erased_runs is append-only';
  end if;
  -- Deleted only while an account is being erased (erase_account sets novera.erasing_account).
  if coalesce(current_setting('novera.erasing_account', true), 'off') <> 'on' then
    raise exception 'allowance_spent_by_erased_runs rows leave only with their owner''s account';
  end if;
  return old;
end;
$$;
drop trigger if exists allowance_spent_frozen on allowance_spent_by_erased_runs;
create trigger allowance_spent_frozen before update or delete on allowance_spent_by_erased_runs
  for each row execute function allowance_spent_frozen();

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

  -- 0078: what this workspace's runs spent from its owner's allowances is written down before
  -- they go, while their recorded scenarios still show which ones counted. The trial and an
  -- owner-wide pilot pool belong to the owner, not the workspace, and must not come back.
  insert into allowance_spent_by_erased_runs (owner_id, workspace_id, run_id, judge_source, funded_by_grant, run_created_at)
  select w.owner_id, r.workspace_id, r.id, r.judge_source, r.funded_by_grant, r.created_at
    from runs r join workspaces w on w.id = r.workspace_id
   where r.workspace_id = target
     and not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id))
  on conflict (run_id) do nothing;

  -- 0054's tables first: they reference runs' neighbours only through the workspace.
  delete from assistant_memory_candidates where workspace_id = target;
  delete from assistant_memory      where workspace_id = target;
  delete from assistant_threads     where workspace_id = target;
  delete from workspace_invitations where workspace_id = target;
  delete from audit_events          where workspace_id = target;
  -- 0061: export receipts. They name the workspace only; the files were never stored.
  delete from workspace_exports     where workspace_id = target;
  -- 0062: counts only, but they name the workspace.
  delete from product_events        where workspace_id = target;
  -- A profile pointing here loses the default, not the profile.
  update user_profiles set default_workspace_id = null where default_workspace_id = target;
  update user_profiles set default_agent_id = null
   where default_agent_id in (select id from agents where workspace_id = target);

  -- 0068: contract acceptances. They name the workspace and the person who accepted.
  delete from contract_acceptances         where workspace_id = target;
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
    -- 0078: and the runs of workspaces this owner has since erased.
    used := used + (select count(*) from allowance_spent_by_erased_runs e where e.owner_id = owner);
    if used >= 3 then
      raise exception 'trial_exhausted: the trial covers 3 runs per account and the owner of workspace % has used them', new.workspace_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function runs_fair_use_and_funding()
returns trigger language plpgsql as $$
declare
  in_flight integer;
  recent    integer;
  sub       billing_subscriptions;
  g         billing_entitlement_grants;
  allowance integer;
  used      integer;
  grant_found boolean;
  ws_owner  uuid;
  in_scope  boolean;
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
    grant_found := found;
    select owner_id into ws_owner from workspaces where id = new.workspace_id;
    -- The run's own workspace's grant, or an owner-wide grant of the run's workspace's owner.
    in_scope := coalesce(grant_found and (g.workspace_id = new.workspace_id or g.owner_id = ws_owner), false);
    if not in_scope or g.revoked_at is not null
       or g.starts_at > now() or (g.ends_at is not null and g.ends_at <= now()) then
      raise exception 'run_not_funded: grant % is not in force for workspace %', new.funded_by_grant, new.workspace_id;
    end if;
    if g.runs_allowed is not null then
      if g.owner_id is null then
        select count(*) into used from runs r
         where r.workspace_id = new.workspace_id and r.created_at >= g.starts_at
           and (g.ends_at is null or r.created_at < g.ends_at)
           and not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id));
        if used >= g.runs_allowed then
          raise exception 'grant_exhausted: grant % allows % runs and % have started', g.id, g.runs_allowed, used;
        end if;
      else
        -- One pool for every workspace the owner owns: starts in two of them queue here, after
        -- each took its own workspace's lock, and each counts what the other wrote.
        perform pg_advisory_xact_lock(hashtext('novera:owner-pool'), hashtext(g.owner_id::text));
        select count(*) into used from runs r
         where r.funded_by_grant = g.id
           and not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id));
        -- 0078: and the units its runs spent in workspaces since erased.
        used := used + (select count(*) from allowance_spent_by_erased_runs e where e.funded_by_grant = g.id);
        if used >= g.runs_allowed then
          raise exception 'grant_exhausted: grant % allows % runs across the owner''s workspaces and % have started', g.id, g.runs_allowed, used;
        end if;
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


create or replace function erase_account(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owned integer;
  n_ws integer;
  n_inv integer;
  address text;
  pseudonym text := 'deleted-' || target || '@deleted.invalid';
begin
  select count(*) into owned from workspaces where owner_id = target;
  if owned > 0 then raise exception 'owns_workspaces'; end if;
  select lower(btrim(email)) into address from auth.users where id = target;
  perform set_config('novera.erasing_account', 'on', true);
  select count(*) into n_ws from workspace_members where user_id = target;
  update api_keys set revoked_at = now(), revoked_by = target where created_by = target and revoked_at is null;
  delete from workspace_members where user_id = target;
  delete from assistant_memory_candidates where user_id = target;
  delete from assistant_memory where user_id = target;
  delete from assistant_threads where user_id = target;
  delete from audit_events where workspace_id is null and actor_id = target;
  delete from user_profiles where user_id = target;
  -- 0078: what their erased workspaces' runs spent; a deleted account starts no run.
  delete from allowance_spent_by_erased_runs where owner_id = target;
  -- Every invitation that names this person: the one they accepted, and any to their address.
  update workspace_invitations
     set email = pseudonym,
         revoked_at = case when accepted_at is null and revoked_at is null then now() else revoked_at end,
         revoked_by = case when accepted_at is null and revoked_at is null then target else revoked_by end
   where accepted_by = target or (address is not null and email = address);
  get diagnostics n_inv = row_count;
  perform set_config('novera.erasing_account', 'off', true);
  return jsonb_build_object('memberships_left', n_ws, 'invitations_pseudonymised', n_inv);
end;
$$;

revoke all on function erase_account(uuid) from public, anon, authenticated;
