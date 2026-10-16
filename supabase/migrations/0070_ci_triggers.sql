-- CI gating: a pipeline names its commit, Novera runs once per commit.
--
-- Three changes, all to the API's edge, none to how a run is started or graded (startRun
-- stays the one way in):
--
-- 1. A fifth scope, `probe`, for a single-scenario check. The endpoint arrives separately;
--    the scope is added now so a key can be created for it, and like every scope beyond
--    `read` it is never granted without `read`. Existing keys are untouched: scopes are
--    frozen at creation (0033).
--
-- 2. `api_keys.last_used_at`, so a person can tell a key in use from one nobody has called
--    in months before revoking it. The key row stays frozen (0033): this column is the one
--    more thing an update may change, it only moves forward, and a revoked key still
--    accepts no change at all. The server writes it at most once a minute per key, never
--    on every request.
--
-- 3. `ci_triggers`: which commit, branch and pull request asked for which run, through
--    which key. One row per run started by POST /api/v1/ci/trigger.
--     * Claimed before the run exists, with the id the run will be created with (as
--       run_requests, 0049), so a retried or concurrent trigger for the same commit finds
--       either that run or proof that it never started — no moment exists at which two
--       runs could start for one commit. `run_id` therefore has no foreign key.
--     * One live row per (workspace, agent, suite, language, commit): the partial unique index is
--       what makes "same commit again → the same run" hold under any number of racing
--       requests.
--     * A row is retired, never edited, when its run was aborted (stopped, superseded,
--       halted because the agent could not be reached): an aborted run never seals a
--       report, so the same commit may be tested again and gets a new run and a new row.
--       Retirement is permitted only once the run is aborted, and only once.
--     * A claim whose run never started (refused, or the request died) may be deleted;
--       a row whose run exists may not, except by erase_workspace().
--     * Members read their workspace's rows; only the server writes. Erasure: every
--       reference cascades from rows erase_workspace() deletes (the workspace, its agents,
--       suites and keys), with novera.erasing on, so the body of erase_workspace() does
--       not change here.

-- 1. The `probe` scope -------------------------------------------------------------------

alter table api_keys drop constraint if exists api_keys_scopes_check;
alter table api_keys add constraint api_keys_scopes_check check (
  cardinality(scopes) > 0
  and scopes <@ array['read', 'run', 'write', 'responses', 'probe']
  and (not ('run' = any(scopes)) or 'read' = any(scopes))
  and (not ('write' = any(scopes)) or 'read' = any(scopes))
  and (not ('responses' = any(scopes)) or 'read' = any(scopes))
  and (not ('probe' = any(scopes)) or 'read' = any(scopes))
);

-- 2. When a key was last used -------------------------------------------------------------

alter table api_keys add column if not exists last_used_at timestamptz;
comment on column api_keys.last_used_at is
  'When the key last authenticated a request, to the minute: written at most once a minute per key. '
  'Moves only forward; null when never used.';

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

  -- 0070: the last use only moves forward. It is a record of a request, not a setting.
  if old.last_used_at is not null
  and (new.last_used_at is null or new.last_used_at < old.last_used_at) then
    raise exception 'An API key''s last use cannot move backwards';
  end if;

  return new;
end;
$$;

-- Members read it with the rest of the row; the hash stays out of reach (0033).
grant select (last_used_at) on api_keys to authenticated;

-- 3. Which commit asked for which run -------------------------------------------------------

create table if not exists ci_triggers (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces (id) on delete cascade,
  agent_id       uuid not null references agents (id) on delete cascade,
  suite_id       uuid not null references suites (id) on delete cascade,
  -- The id the run is created with; claimed before the run row exists, so no foreign key.
  run_id         uuid not null unique,
  git_commit_sha text check (git_commit_sha ~ '^[0-9a-f]{7,64}$'),
  git_branch     text check (length(git_branch) between 1 and 255 and git_branch !~ '[[:cntrl:]]'),
  pr_number      integer check (pr_number > 0),
  -- The language the run was sent in: one commit may be tested in several (Block 5).
  locale         text not null default 'en' check (locale in ('en', 'de', 'fr', 'ro')),
  api_key_id     uuid not null references api_keys (id) on delete cascade,
  created_at     timestamptz not null default now(),
  -- Set once, when the run was aborted and the commit may be tested again.
  retired_at     timestamptz
);

create unique index if not exists ci_triggers_one_run_per_commit
  on ci_triggers (workspace_id, agent_id, suite_id, locale, git_commit_sha)
  where git_commit_sha is not null and retired_at is null;
create index if not exists ci_triggers_by_branch
  on ci_triggers (workspace_id, agent_id, git_branch, created_at desc);

comment on table ci_triggers is
  'Which commit, branch and pull request started which run through POST /api/v1/ci/trigger. '
  'One live row per (workspace, agent, suite, language, commit). Claimed before the run exists; retired once, '
  'only when its run was aborted; deleted only while its run does not exist, or by erasure.';

alter table ci_triggers enable row level security;
drop policy if exists ci_triggers_select on ci_triggers;
create policy ci_triggers_select on ci_triggers for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table ci_triggers from public, anon, authenticated;

drop trigger if exists ci_triggers_same_workspace on ci_triggers;
create trigger ci_triggers_same_workspace before insert or update on ci_triggers for each row
  execute function refuse_cross_workspace(
    'agent_id', 'agents', 'suite_id', 'suites', 'api_key_id', 'api_keys', 'run_id', 'runs');

create or replace function ci_triggers_guard()
returns trigger language plpgsql as $$
declare
  run_status text;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    -- A claim whose run never started (refused, or the request died) leaves no trace of a run.
    if not exists (select 1 from runs where id = old.run_id) then
      return old;
    end if;
    raise exception 'A CI trigger whose run exists cannot be deleted';
  end if;

  if new.id is distinct from old.id
  or new.workspace_id is distinct from old.workspace_id
  or new.agent_id is distinct from old.agent_id
  or new.suite_id is distinct from old.suite_id
  or new.run_id is distinct from old.run_id
  or new.git_commit_sha is distinct from old.git_commit_sha
  or new.git_branch is distinct from old.git_branch
  or new.locale is distinct from old.locale
  or new.pr_number is distinct from old.pr_number
  or new.api_key_id is distinct from old.api_key_id
  or new.created_at is distinct from old.created_at then
    raise exception 'A CI trigger cannot be changed';
  end if;

  if old.retired_at is not null then
    raise exception 'A retired CI trigger stays retired';
  end if;
  if new.retired_at is not null then
    select status into run_status from runs where id = old.run_id;
    if run_status is distinct from 'aborted' then
      raise exception 'A CI trigger is retired only once its run was aborted';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ci_triggers_guard on ci_triggers;
create trigger ci_triggers_guard before update or delete on ci_triggers
  for each row execute function ci_triggers_guard();
