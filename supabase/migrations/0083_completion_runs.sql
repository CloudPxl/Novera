-- Completion runs (2026-11-11).
--
-- A run that completed with scenarios that produced no result — a grader rate-limited, an agent
-- that timed out — could be unblocked only by rerunning the whole suite. A completion run
-- re-executes only those scenarios, through the one run path, and its report combines them with
-- the original run's stored rows. Nothing about the original changes: its rows are append-only,
-- its report stays sealed and keeps verifying, and the completion report names it by digest.
--
-- What the database holds:
--   * `runs.completes_run_id` names the run completed, set at insert and never changed;
--   * it must agree with the manifest's own `completes.run_id`, which is frozen with the manifest
--     (0016) — so the run's declaration and its column cannot tell two stories;
--   * the run it completes is in the same workspace (0034's refuse_cross_workspace);
--   * one completion of a run in progress at a time;
--   * which scenarios it may record is its manifest's `suite.case_ids`, as for every run (0043,
--     0048): a completion run declares only the scenarios it re-executes.
--
-- Erasure: runs are deleted by erase_workspace() in one statement per workspace, and a completion
-- run is always in its original's workspace, so the self-reference never blocks it (NO ACTION is
-- checked at the end of the statement). Its body is not redefined here.

alter table runs add column if not exists completes_run_id uuid references runs (id);

alter table runs drop constraint if exists runs_completes_not_itself;
alter table runs add constraint runs_completes_not_itself check (completes_run_id is null or completes_run_id <> id);

alter table runs drop constraint if exists runs_completes_matches_manifest;
alter table runs add constraint runs_completes_matches_manifest
  check (completes_run_id is null or (manifest -> 'completes' ->> 'run_id') = completes_run_id::text);

comment on column runs.completes_run_id is
  'Set only on a completion run: the run whose no-result scenarios it re-executes. Agrees with manifest.completes.run_id, set at insert, never changed (0083).';

create unique index if not exists runs_one_completion_in_progress
  on runs (completes_run_id) where completes_run_id is not null and status in ('queued', 'running');

create or replace function runs_completes_frozen()
returns trigger language plpgsql as $$
begin
  if new.completes_run_id is distinct from old.completes_run_id then
    raise exception 'Which run a completion run completes is set when it is created and never changes' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists runs_completes_frozen on runs;
create trigger runs_completes_frozen before update on runs
  for each row execute function runs_completes_frozen();

drop trigger if exists runs_completes_same_workspace on runs;
create trigger runs_completes_same_workspace before insert or update on runs for each row
  execute function refuse_cross_workspace('completes_run_id', 'runs');
