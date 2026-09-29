-- Scheduled re-evaluations: a run the calendar starts, on the same path as the button.
--
-- A schedule is configuration, not evidence, so it may change — but only in the ways a
-- person would expect: it can be paused, resumed and cancelled, and the clock moves it
-- forward. What it runs (agent, suite), when (cadence, hour, weekday), and who set it
-- up are fixed: a different schedule is a new row. Cancelling is permanent, and a
-- schedule is never deleted, because the runs it started name it (runs.schedule_id).
--
-- The clock is pg_cron, calling /api/cron/tick through pg_net only when something is due
-- or a scheduled run is still in progress — an idle workspace costs no request at all.
-- The job itself is installed by `npm run schedules:install`, not here: it needs the
-- deployment's address and a secret, and a migration must not carry either.

create table if not exists run_schedules (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces (id) on delete cascade,
  agent_id       uuid not null references agents (id),
  -- Pinned, never "whatever is newest": a schedule exists to compare like with like.
  suite_id       uuid not null references suites (id),
  cadence        text not null check (cadence in ('daily', 'weekly')),
  hour_utc       smallint not null check (hour_utc between 0 and 23),
  -- 0 = Sunday … 6 = Saturday, as JavaScript's getUTCDay. Weekly only.
  weekday        smallint check (weekday between 0 and 6),
  next_run_at    timestamptz not null,
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default now(),
  paused_at      timestamptz,
  -- Why it paused: a person pressed pause (null), or a run could not start (the reason).
  paused_reason  text,
  cancelled_at   timestamptz,
  cancelled_by   uuid references auth.users (id),
  last_attempt_at timestamptz,
  last_outcome   text,
  check ((cadence = 'weekly') = (weekday is not null)),
  check ((cancelled_at is null) = (cancelled_by is null)),
  check (paused_reason is null or paused_at is not null)
);

create index if not exists run_schedules_due_idx on run_schedules (next_run_at)
  where paused_at is null and cancelled_at is null;
create index if not exists run_schedules_agent_idx on run_schedules (workspace_id, agent_id, created_at desc);

alter table run_schedules enable row level security;

drop policy if exists run_schedules_select on run_schedules;
create policy run_schedules_select on run_schedules for select
  using (is_workspace_member(workspace_id));
-- No write policy for signed-in users: the server writes after checking membership.

create or replace function run_schedules_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A schedule cannot be deleted; cancel it. The runs it started name it.';
  end if;

  if new.id is distinct from old.id
  or new.workspace_id is distinct from old.workspace_id
  or new.agent_id is distinct from old.agent_id
  or new.suite_id is distinct from old.suite_id
  or new.cadence is distinct from old.cadence
  or new.hour_utc is distinct from old.hour_utc
  or new.weekday is distinct from old.weekday
  or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at then
    raise exception 'What a schedule runs and when cannot be changed; cancel it and create another';
  end if;

  if old.cancelled_at is not null then
    raise exception 'A cancelled schedule stays cancelled';
  end if;

  return new;
end;
$$;

drop trigger if exists run_schedules_guard on run_schedules;
create trigger run_schedules_guard before update or delete on run_schedules
  for each row execute function run_schedules_guard();

drop trigger if exists run_schedules_same_workspace on run_schedules;
create trigger run_schedules_same_workspace before insert or update on run_schedules for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'suite_id', 'suites');

comment on table run_schedules is
  'Scheduled re-evaluations. Agent, suite, cadence and creator are fixed; pause, resume and '
  'cancel (permanent) are the permitted changes. Never deleted except by erase_workspace().';

-- A run names the schedule that started it, the way it names an API key (0035).
alter table runs add column if not exists schedule_id uuid references run_schedules (id) on delete restrict;
comment on column runs.schedule_id is
  'The schedule that started this run. Null when a person or an API key did.';

drop trigger if exists runs_same_workspace on runs;
create trigger runs_same_workspace before insert or update on runs for each row
  execute function refuse_cross_workspace(
    'agent_id', 'agents', 'policy_id', 'policies', 'suite_id', 'suites', 'baseline_run_id', 'runs',
    'api_key_id', 'api_keys', 'schedule_id', 'run_schedules');

-- Who started a run is a fact about the past. Found while adding schedule_id: nothing
-- stopped created_by or api_key_id from being rewritten after the run existed.
create or replace function freeze_run_attribution() returns trigger
language plpgsql as $$
begin
  if new.created_by is distinct from old.created_by
  or new.api_key_id is distinct from old.api_key_id
  or new.schedule_id is distinct from old.schedule_id then
    raise exception 'Who started a run cannot be changed after the run exists';
  end if;
  return new;
end;
$$;

drop trigger if exists runs_freeze_attribution on runs;
create trigger runs_freeze_attribution before update on runs
  for each row execute function freeze_run_attribution();

-- The slice lease gets its own column. It used to be started_at, rewritten by every
-- slice, which had two effects: a report's duration measured the last slice rather than
-- the whole run (the code said otherwise), and a finished slice held the run for the
-- rest of its 70 seconds, so the next slice waited ~25 s for nothing. A slice now
-- releases the lease when it hands back, and started_at is written once.
alter table runs add column if not exists lease_until timestamptz;
comment on column runs.lease_until is
  'Until when a slice is working on this run. Null when no slice holds it. A run past its '
  'lease may be taken over; stored cases are skipped, so a takeover only adds evidence.';

-- A run in flight while this migration applies keeps the lease it had.
update runs set lease_until = started_at + interval '70 seconds'
  where status = 'running' and started_at is not null and lease_until is null;

-- Erasure: runs name schedules, so schedules go after runs and before agents.
-- Eleventh time an erasure path ships with its table.
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
  -- After the runs that name them, before the agents and suites they name.
  delete from run_schedules         where workspace_id = target;
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
