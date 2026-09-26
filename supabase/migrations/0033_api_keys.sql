-- Workspace API keys: the first way into a workspace that is not a person's session.
--
-- Designed as a credential, not as a setting:
--  * The key itself is shown once and never stored. What is kept is an HMAC of it under
--    the server's secret, so a copy of this table — a backup, a leaked export — opens
--    nothing. `prefix` is the first characters, for a person to tell keys apart.
--  * Scopes are a closed list. `read` is the only one this migration allows; a write
--    scope arrives with the endpoint that needs it, and not before.
--  * Revocation is the one change a key accepts, and it is permanent. A key cannot be
--    renamed, re-scoped or un-revoked: a different key is a new row with a new secret.
--  * A key can be read by members of its workspace (never its hash, see the column
--    grant below) and created only by the server, which checks membership first.

create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  prefix       text not null,
  key_hash     text not null unique,
  scopes       text[] not null default array['read']
               check (cardinality(scopes) > 0 and scopes <@ array['read']),
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users (id),
  check ((revoked_at is null) = (revoked_by is null))
);

create index if not exists api_keys_workspace_idx on api_keys (workspace_id, created_at desc);

alter table api_keys enable row level security;

drop policy if exists api_keys_select on api_keys;
create policy api_keys_select on api_keys for select
  using (is_workspace_member(workspace_id));
-- No insert, update or delete policy for signed-in users: keys are created and revoked
-- by the server after it has checked membership, with the service role.

-- The hash is not a secret on its own, but there is no reason a browser should ever
-- hold it. Members read everything else.
revoke select on api_keys from anon, authenticated;
grant select (id, workspace_id, name, prefix, scopes, created_by, created_at, revoked_at, revoked_by)
  on api_keys to authenticated;

create or replace function api_keys_revoke_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'An API key cannot be deleted; revoke it, which records who and when';
  end if;

  if new.id is distinct from old.id
  or new.workspace_id is distinct from old.workspace_id
  or new.name is distinct from old.name
  or new.prefix is distinct from old.prefix
  or new.key_hash is distinct from old.key_hash
  or new.scopes is distinct from old.scopes
  or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at then
    raise exception 'An API key cannot be changed; revoke it and create another';
  end if;

  if old.revoked_at is not null then
    raise exception 'A revoked API key stays revoked';
  end if;

  return new;
end;
$$;

drop trigger if exists api_keys_revoke_only on api_keys;
create trigger api_keys_revoke_only before update or delete on api_keys
  for each row execute function api_keys_revoke_only();

comment on table api_keys is
  'Workspace API keys. Only an HMAC of the key is stored; shown once at creation. Scopes '
  'are a closed list (read). Revocation is the only permitted change and is permanent. '
  'Reachable for deletion only by erase_workspace().';

-- Every table that refuses deletion needs an erasure path designed alongside it.
-- Tenth time (0005, 0007, 0010, 0013, 0020, 0022, 0028, 0031, and here).
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

  delete from reports               where workspace_id = target;
  delete from diagnoses             where workspace_id = target;
  delete from case_retests          where workspace_id = target;
  delete from evidence_observations where workspace_id = target;
  -- Before run_cases, which it references.
  delete from verdict_reviews       where workspace_id = target;
  delete from run_cases             where workspace_id = target;
  delete from runs                  where workspace_id = target;
  delete from probes                where workspace_id = target;
  delete from scenario_drafts       where workspace_id = target;
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

revoke execute on function erase_workspace(uuid, uuid) from anon, authenticated;
