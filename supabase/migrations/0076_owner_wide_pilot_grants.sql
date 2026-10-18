-- A pilot redeemed from a code covers every workspace its owner owns (decision 2026-10-17, lead;
-- docs/BILLING-DECISIONS.md, "Owner-wide pilots").
--
-- The agency journey broke at its second step. An agency redeems a pilot code in its own
-- workspace (0075), then adds a workspace per client (/workspaces, "Add a client") and connects
-- each client's agent there. The trial (0055) belongs to the owner across their workspaces, but a
-- grant belonged to one workspace: 0067 refused a run whose grant was another workspace's, and
-- 0075 allowed one code per workspace. So no client workspace could run under the pilot.
--
-- A grant now has a scope:
--
--   billing_entitlement_grants.owner_id   null — this workspace only, exactly as before (every
--                                         existing grant, and every manual grant unless an
--                                         operator names the owner); set — every workspace that
--                                         person owns, one pool. Set only to the owner of the
--                                         workspace that holds the grant, checked at insert;
--                                         frozen with the other terms.
--
-- What an owner-wide grant changes, and where:
--
--   1. Funding (0067's check, in runs_fair_use_and_funding): a run may name a grant held by
--      another workspace when both workspaces have the same owner and the grant names that owner.
--      This is the one reference between workspaces the tenancy rule (0034) allows, and it is
--      checked here, under the service role too.
--   2. Counting: an owner-wide grant's units are the runs that name it (funded_by_grant = its
--      id), in every workspace, except a run aborted before it recorded any scenario (0074's
--      rule, unchanged). A one-workspace grant keeps its window count over its workspace's runs
--      (0067, 0074), so no existing number changes.
--   3. Locks, one global order: the per-workspace lock (novera:run-start, taken first by this
--      trigger, as since 0067), then the per-owner pool lock (novera:owner-pool, only for an
--      owner-wide grant, before its count), then the per-owner trial lock (novera:trial-cap,
--      runs_trial_cap, fired after this trigger in name order, only for a trial_free run). No
--      path takes them in another order, so racing starts across one owner's workspaces queue on
--      the pool lock and cannot overspend it, and none can deadlock: a start holds at most one
--      workspace lock while it waits for the owner's.
--   4. Redemption (redeem_pilot_code, redefined): one pilot code per owner, in whichever of their
--      workspaces it is typed, checked under a per-owner lock (novera:pilot-redeem) before the
--      code is looked at, and refused again by a trigger on the redemptions table, so a direct
--      insert cannot add a second. The grant it creates is owner-wide. 0075's unique
--      (workspace_id) stays: it is implied by one per owner and still backs the race handler.
--      Outcome `owner_has_pilot` replaces `workspace_has_pilot`.
--   5. Ownership is fixed. Transfer is not built (0054: the owner cannot be removed or demoted,
--      and nobody else is made owner); a trigger now refuses changing workspaces.owner_id, so a
--      pool's scope cannot move under it. Building transfer later has to decide what a
--      transferred workspace does with its owner's pool (proposed: it leaves the pool; the pool
--      stays with the person).
--   6. model_operations.funded_by (0059) gains 'plan_managed': model work on Novera's keys while
--      a grant or a plan funds this workspace's runs on them, as a run started then would be
--      stamped. Existing rows are untouched.
--
-- Erasure. No new table, so no new erasure path: owner_id leaves with its grant in
-- erase_workspace(), whose body is unchanged. Erasing the workspace that holds an owner-wide
-- grant deletes the grant, and the pool ends for every workspace the owner owns — a deliberate
-- act on the workspace that holds the billing record, said beside the erase button. Runs in the
-- other workspaces keep the grant's id in funded_by_grant (frozen, not a foreign key, as since
-- 0067); it names nothing once the grant is gone. Erasing another of the owner's workspaces
-- removes its runs, and the pool counts only runs that exist — the same as the trial (0055).
-- erase_account() refuses while the person owns workspaces (0058), and the application erases
-- them first, so an account's pool leaves with its workspaces.

-- ------------------------------------------------------------------ the scope
alter table billing_entitlement_grants add column if not exists owner_id uuid;
comment on column billing_entitlement_grants.owner_id is
  'The grant''s scope (0076). Null: the workspace that holds it. Set: every workspace this user owns, one pool counted by grant id. Only the holding workspace''s owner; frozen.';
create index if not exists billing_entitlement_grants_owner on billing_entitlement_grants (owner_id) where owner_id is not null;

-- An owner-wide grant names the owner of the workspace that holds it, at insert. Ownership is
-- fixed below, so it stays true.
create or replace function billing_grants_owner_scope()
returns trigger language plpgsql as $$
begin
  if new.owner_id is not null
     and new.owner_id is distinct from (select owner_id from workspaces where id = new.workspace_id) then
    raise exception 'An owner-wide grant names the owner of the workspace that holds it.';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_grants_owner_scope on billing_entitlement_grants;
create trigger billing_grants_owner_scope before insert on billing_entitlement_grants
  for each row execute function billing_grants_owner_scope();

-- 0060's guard, with the scope frozen beside the other terms.
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
     or new.reason <> old.reason or new.granted_by <> old.granted_by or new.created_at <> old.created_at
     or new.owner_id is distinct from old.owner_id then
    raise exception 'A grant''s terms are frozen; revoke it and grant again.';
  end if;
  if old.revoked_at is not null then
    raise exception 'A revoked grant stays revoked.';
  end if;
  return new;
end;
$$;

revoke all on function billing_grants_owner_scope() from public, anon, authenticated;

-- ------------------------------------------------------------------ ownership is fixed
create or replace function workspaces_owner_fixed()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'A workspace''s owner does not change: ownership transfer is not built, and an owner-wide grant is scoped by it.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_owner_fixed on workspaces;
create trigger workspaces_owner_fixed before update of owner_id on workspaces
  for each row execute function workspaces_owner_fixed();

revoke all on function workspaces_owner_fixed() from public, anon, authenticated;

-- ------------------------------------------------------------------ funding and counting
-- Counting an owner-wide grant reads runs by the grant they name.
create index if not exists runs_funded_by_grant on runs (funded_by_grant) where funded_by_grant is not null;

-- 0074's body, with the owner-wide grant accepted in the funding check and counted by grant id
-- under the per-owner pool lock. Fair use, the subscription check, the managed allowance and a
-- one-workspace grant's count are unchanged.
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

-- The trigger itself is unchanged (0067: before insert on runs, fired before runs_trial_cap in
-- name order); `create or replace` keeps it bound to the new body.

-- ------------------------------------------------------------------ one pilot per owner
-- Refused in the table too, so no insert — the function's or the service role's — adds a second
-- redemption for an owner. The same per-owner lock as redeem_pilot_code (reentrant there), so two
-- of one owner's workspaces redeeming at once queue, and the second reads the first.
create or replace function billing_pilot_redemptions_one_per_owner()
returns trigger language plpgsql as $$
declare
  owner uuid;
begin
  select owner_id into owner from workspaces where id = new.workspace_id;
  perform pg_advisory_xact_lock(hashtext('novera:pilot-redeem'), hashtext(owner::text));
  if exists (
    select 1 from billing_pilot_code_redemptions r join workspaces w on w.id = r.workspace_id
     where w.owner_id = owner
  ) then
    raise exception 'owner_has_pilot: the owner of workspace % already redeemed a pilot code', new.workspace_id
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_pilot_redemptions_one_per_owner on billing_pilot_code_redemptions;
create trigger billing_pilot_redemptions_one_per_owner before insert on billing_pilot_code_redemptions
  for each row execute function billing_pilot_redemptions_one_per_owner();

revoke all on function billing_pilot_redemptions_one_per_owner() from public, anon, authenticated;

-- Outcomes, as jsonb {outcome, ...}:
--   redeemed         {grant_id, runs_allowed, ends_at}: an owner-wide pilot grant.
--   owner_has_pilot  the workspace's owner already redeemed a code, in this workspace or another
--                    they own. Checked under the per-owner lock before the code is looked at, so
--                    an owner who has one learns nothing about other codes.
--   invalid          unknown, revoked or past its redeem-by date: one outcome (0075).
--   used_up          every redemption the code allows has been made (0075).
create or replace function redeem_pilot_code(p_code_hash text, p_workspace uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c billing_pilot_codes%rowtype;
  grant_row uuid;
  ends timestamptz;
  owner uuid;
begin
  -- The server checked the role (billing.manage); checked again here, for the service role too.
  if not exists (
    select 1 from workspace_members
     where workspace_id = p_workspace and user_id = p_user and role in ('owner', 'admin')
  ) then
    raise exception 'Only an owner or admin of the workspace redeems a pilot code.' using errcode = '42501';
  end if;

  -- One pilot per owner. Lock order: the owner first, then the code's row.
  select owner_id into owner from workspaces where id = p_workspace;
  perform pg_advisory_xact_lock(hashtext('novera:pilot-redeem'), hashtext(owner::text));
  if exists (
    select 1 from billing_pilot_code_redemptions r join workspaces w on w.id = r.workspace_id
     where w.owner_id = owner
  ) then
    return jsonb_build_object('outcome', 'owner_has_pilot');
  end if;

  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Two owners racing for one single-use code queue here; the second reads the first's count.
  select * into c from billing_pilot_codes where code_hash = p_code_hash for update;
  if not found or c.revoked_at is not null or (c.expires_at is not null and now() >= c.expires_at) then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if c.redemptions_count >= c.max_redemptions then
    return jsonb_build_object('outcome', 'used_up');
  end if;

  ends := now() + make_interval(days => c.duration_days);
  begin
    -- Held by the workspace it was typed in, shared by every workspace its owner owns. The reason
    -- names the code by its hint only; the label is internal and may name the agency.
    insert into billing_entitlement_grants (workspace_id, owner_id, kind, runs_allowed, ends_at, reason, granted_by)
    values (p_workspace, owner, 'pilot', c.runs_allowed, ends, 'Pilot code ' || c.hint || ' redeemed', c.granted_by)
    returning id into grant_row;

    update billing_pilot_codes set redemptions_count = redemptions_count + 1 where code_hash = c.code_hash;

    insert into billing_pilot_code_redemptions (code_hash, workspace_id, grant_id, redeemed_by)
    values (c.code_hash, p_workspace, grant_row, p_user);

    -- The billing trail and the workspace's audit trail. Ids, counts and the scope; never the
    -- code or its hash.
    insert into billing_events (workspace_id, actor_id, source, action, detail)
    values (p_workspace, p_user, 'member', 'pilot_code.redeemed', jsonb_build_object(
      'grant_id', grant_row, 'runs_allowed', c.runs_allowed, 'duration_days', c.duration_days, 'ends_at', ends,
      'scope', 'owner'));
    insert into audit_events (workspace_id, actor_id, action, detail)
    values (p_workspace, p_user, 'billing.pilot_code_redeemed', jsonb_build_object(
      'grant_id', grant_row, 'runs_allowed', c.runs_allowed, 'ends_at', ends, 'scope', 'owner'));
  exception when unique_violation then
    -- The owner redeemed another code at the same moment and won. Everything in this block is
    -- undone; the count did not move.
    return jsonb_build_object('outcome', 'owner_has_pilot');
  end;

  return jsonb_build_object('outcome', 'redeemed', 'grant_id', grant_row, 'runs_allowed', c.runs_allowed, 'ends_at', ends);
end;
$$;

revoke all on function redeem_pilot_code(text, uuid, uuid) from public, anon, authenticated;

comment on function redeem_pilot_code(text, uuid, uuid) is
  'Turns a pilot code into a pilot grant shared by every workspace the redeeming workspace''s owner owns, all or nothing: redeemed, owner_has_pilot, invalid (unknown, revoked or expired) or used_up. Service role only.';

-- ------------------------------------------------------------------ model work funded by a grant or plan
alter table model_operations drop constraint if exists model_operations_funded_by_check;
alter table model_operations add constraint model_operations_funded_by_check
  check (funded_by in ('trial_free', 'workspace_key', 'plan_managed'));
comment on column model_operations.funded_by is
  'Who paid for the operation: the workspace''s own key, Novera''s keys under a grant or plan that funds runs on them (plan_managed, 0076), or Novera''s trial allowance.';

notify pgrst, 'reload schema';
