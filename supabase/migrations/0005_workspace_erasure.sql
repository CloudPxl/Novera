-- Erasure.
--
-- The append-only triggers made a workspace undeletable: any cascade reached
-- policies, probes, run_cases or reports and was refused. For a product that
-- evidences how agents handle erasure requests, being unable to honour one is not a
-- tolerable defect.
--
-- The two requirements are not in conflict once stated precisely:
--   * no piecemeal deletion — a verdict, a policy version or a report cannot be
--     removed to make an agent look better than it was;
--   * complete erasure — a customer can have everything about their workspace
--     removed, all of it, deliberately, in one authorised operation.
--
-- So the triggers refuse DELETE unless a transaction-local flag marks it as part of
-- an authorised erasure, and only erase_workspace() sets that flag. set_config with
-- is_local = true confines it to the transaction, so it cannot leak into later work
-- on the same connection.

-- What survives an erasure: proof that it happened, with no personal data in it.
create table erasure_log (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  requested_by   uuid,
  erased_at      timestamptz not null default now(),
  agents_removed integer not null default 0,
  runs_removed   integer not null default 0,
  cases_removed  integer not null default 0,
  reports_removed integer not null default 0
);
alter table erasure_log enable row level security;
-- No policy: readable only by the server. A record of erasure is not workspace data.

create or replace function erasing_workspace()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('novera.erasing', true), '') = 'on';
$$;

create or replace function refuse_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and erasing_workspace() then
    return old;
  end if;
  raise exception 'Table % is append-only: % is not permitted', tg_table_name, tg_op;
end;
$$;

create or replace function reports_revoke_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'Reports are append-only; revoke instead of deleting';
  end if;
  if new.payload is distinct from old.payload
     or new.content_hash is distinct from old.content_hash
     or new.run_id is distinct from old.run_id
     or new.token is distinct from old.token
     or new.created_at is distinct from old.created_at then
    raise exception 'Only revoked_at and expires_at may be changed on a report';
  end if;
  return new;
end;
$$;

-- The single authorised erasure path. Counts first so the log is accurate, then
-- deletes in dependency order so no RESTRICT foreign key blocks the cascade.
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

  delete from reports    where workspace_id = target;
  delete from diagnoses  where workspace_id = target;
  delete from run_cases  where workspace_id = target;
  delete from runs       where workspace_id = target;
  delete from probes     where workspace_id = target;
  delete from policies   where workspace_id = target;
  delete from secrets    where workspace_id = target;
  delete from agents     where workspace_id = target;
  delete from suites     where workspace_id = target;
  delete from workspace_members where workspace_id = target;
  delete from workspaces where id = target;

  perform set_config('novera.erasing', 'off', true);

  insert into erasure_log (workspace_id, requested_by, agents_removed, runs_removed, cases_removed, reports_removed)
  values (target, requested_by, n_agents, n_runs, n_cases, n_reports)
  returning * into record;

  return record;
end;
$$;

-- Only the server may call it; erasure goes through an authorisation check in the
-- application, never straight from a browser.
revoke execute on function erase_workspace(uuid, uuid) from anon, authenticated;
