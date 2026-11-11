-- Grading holds (2026-11-11): a no-result Novera caused is finished later, not recorded.
--
-- In the month before this migration, production's completed runs held two no-result scenarios,
-- and both were Novera's: once a slice ended before the second model was asked, once the only
-- third vendor was at its rate limit when two models disagreed. Each agent had answered, and each
-- run was blocked (WITHHELD, release gate exit 2) by a gap that said nothing about the agent.
--
-- A scenario whose grading stopped short of a corroborated verdict only for grading capacity
-- (a model not yet heard from was rate-limited, slow, erroring, skipped or out of time) is held
-- here instead of being recorded: the reply as the agent sent it, the read-back observation, and
-- the opinions given so far. A later slice resumes the grading where it stopped — the models that
-- answered are not asked again, a tie is still settled only by a third vendor — and records the
-- scenario once, in run_cases, exactly as a fresh grading would. After four gradings it is
-- recorded as whatever the grading reached (src/lib/runner/execute.ts, MAX_GRADING_ATTEMPTS).
--
-- What does not change: the agent is never sent the scenario again; a run is marked completed only
-- when every declared scenario has its row (0048), so a run with a hold open stays running; and a
-- hold is not evidence — nothing reads it into a report.
--
-- Erasure: rows hang off runs (id) and workspaces (id) on delete cascade, and carry no
-- refuse_mutation(), so erase_workspace() removes them with the runs. Retention: a hold carries an
-- agent's raw reply for as long as its run is in progress, and no longer — the trigger below
-- deletes a run's holds the moment it leaves queued/running (completed, or aborted, including the
-- 24-hour idle stop of 0040), so no hold outlives the run's own raw evidence or the 0037 pass.

create table if not exists run_case_holds (
  run_id        uuid not null references runs (id) on delete cascade,
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  case_id       text not null check (length(case_id) between 1 and 100),
  -- The case as executed, before grading: reply, transcript, tool activity, latency, agent usage.
  executed      jsonb not null check (jsonb_typeof(executed) = 'object'),
  -- What the customer's own system showed, when a read-back ran. Null otherwise.
  observation   jsonb check (observation is null or jsonb_typeof(observation) = 'object'),
  -- The readable opinions given so far, the models that answered, the attempts that did not.
  grading       jsonb not null check (jsonb_typeof(grading) = 'object'),
  attempts      integer not null check (attempts between 1 and 10),
  not_before    timestamptz not null,
  held_at       timestamptz not null default now(),
  primary key (run_id, case_id)
);

create index if not exists run_case_holds_workspace on run_case_holds (workspace_id);

-- A hold exists only for a scenario the run declared and has not recorded, while it runs.
create or replace function run_case_holds_belong_to_their_run()
returns trigger language plpgsql as $$
declare
  run_status text;
  declared jsonb;
begin
  select status, manifest -> 'suite' -> 'case_ids' into run_status, declared
    from runs where id = new.run_id for share;
  if run_status is null or run_status not in ('queued', 'running') then
    raise exception 'Run % is not in progress; nothing of it can be held', new.run_id;
  end if;
  if jsonb_typeof(declared) = 'array' and not declared ? new.case_id then
    raise exception 'Scenario % is not in the manifest run % declared before it ran', new.case_id, new.run_id;
  end if;
  if exists (select 1 from run_cases where run_id = new.run_id and case_id = new.case_id) then
    raise exception 'Scenario % is already recorded for run %', new.case_id, new.run_id;
  end if;
  return new;
end;
$$;

drop trigger if exists run_case_holds_belong_to_their_run on run_case_holds;
create trigger run_case_holds_belong_to_their_run before insert or update on run_case_holds
  for each row execute function run_case_holds_belong_to_their_run();

drop trigger if exists run_case_holds_cross_workspace on run_case_holds;
create trigger run_case_holds_cross_workspace before insert or update on run_case_holds
  for each row execute function refuse_cross_workspace('run_id', 'runs');

-- A run that leaves queued/running takes its holds with it.
create or replace function drop_holds_of_finished_run()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from run_case_holds where run_id = new.id;
  return null;
end;
$$;

drop trigger if exists drop_holds_of_finished_run on runs;
create trigger drop_holds_of_finished_run after update of status on runs
  for each row when (new.status not in ('queued', 'running') and old.status is distinct from new.status)
  execute function drop_holds_of_finished_run();

revoke all on function drop_holds_of_finished_run() from public, anon, authenticated;

-- The server's alone: no member reads or writes a hold. It is not evidence.
alter table run_case_holds enable row level security;
revoke all on table run_case_holds from public, anon, authenticated;
