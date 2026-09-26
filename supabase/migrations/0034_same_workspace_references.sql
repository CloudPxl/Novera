-- A row may only refer to rows in its own workspace.
--
-- Found on 2026-09-26 while designing run-starting over the API: `createRun` looked up
-- the agent and its latest policy by id with the service role and no workspace filter.
-- Anyone who knew another workspace's agent id could start a run against it from their
-- own workspace — calling that agent's endpoint, and grading it against the other
-- workspace's policy text, which the run then showed them. Agent ids are random UUIDs,
-- but they appear in URLs. Row-level security did not help: the service role bypasses it.
-- No existing row had crossed (all 21 references counted: 0).
--
-- The code is fixed too, but a promise that holds only while every query is written
-- carefully is not the kind this product makes. So the rule is here: every reference
-- between tenant tables must stay inside one workspace. The one exception is a suite
-- with no workspace — a built-in suite, which every workspace may run.
--
-- 0028 did this for verdict_reviews alone; this generalises it and replaces nothing.

create or replace function refuse_cross_workspace()
returns trigger language plpgsql as $$
declare
  i integer := 0;
  col text;
  ref text;
  ref_id uuid;
  owner uuid;
  found_row boolean;
begin
  while i < tg_nargs loop
    col := tg_argv[i];
    ref := tg_argv[i + 1];
    execute format('select ($1).%I', col) into ref_id using new;
    if ref_id is not null then
      execute format('select workspace_id, true from %I where id = $1', ref) into owner, found_row using ref_id;
      -- A missing row is the foreign key's to refuse; a built-in suite is shared.
      if found_row and not (ref = 'suites' and owner is null) and owner is distinct from new.workspace_id then
        raise exception '%.% must refer to a row in the same workspace', tg_table_name, col
          using errcode = '42501';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end;
$$;

comment on function refuse_cross_workspace() is
  'Trigger: each (column, referenced table) pair in TG_ARGV must point at a row in the same '
  'workspace as the new row. A suite with no workspace (built-in) is allowed.';

drop trigger if exists runs_same_workspace on runs;
create trigger runs_same_workspace before insert or update on runs for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'policy_id', 'policies', 'suite_id', 'suites', 'baseline_run_id', 'runs');

drop trigger if exists run_cases_same_workspace on run_cases;
create trigger run_cases_same_workspace before insert or update on run_cases for each row
  execute function refuse_cross_workspace('run_id', 'runs');

drop trigger if exists policies_same_workspace on policies;
create trigger policies_same_workspace before insert or update on policies for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'derived_from', 'policies');

drop trigger if exists probes_same_workspace on probes;
create trigger probes_same_workspace before insert or update on probes for each row
  execute function refuse_cross_workspace('agent_id', 'agents');

drop trigger if exists secrets_same_workspace on secrets;
create trigger secrets_same_workspace before insert or update on secrets for each row
  execute function refuse_cross_workspace('agent_id', 'agents');

drop trigger if exists reports_same_workspace on reports;
create trigger reports_same_workspace before insert or update on reports for each row
  execute function refuse_cross_workspace('run_id', 'runs');

drop trigger if exists diagnoses_same_workspace on diagnoses;
create trigger diagnoses_same_workspace before insert or update on diagnoses for each row
  execute function refuse_cross_workspace('run_case_id', 'run_cases', 'resulting_policy_id', 'policies');

drop trigger if exists case_retests_same_workspace on case_retests;
create trigger case_retests_same_workspace before insert or update on case_retests for each row
  execute function refuse_cross_workspace('run_case_id', 'run_cases', 'policy_id', 'policies');

drop trigger if exists evidence_observations_same_workspace on evidence_observations;
create trigger evidence_observations_same_workspace before insert or update on evidence_observations for each row
  execute function refuse_cross_workspace('run_case_id', 'run_cases');

drop trigger if exists scenario_drafts_same_workspace on scenario_drafts;
create trigger scenario_drafts_same_workspace before insert or update on scenario_drafts for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'policy_id', 'policies',
    'production_failure_id', 'production_failures', 'included_in_suite_id', 'suites');

drop trigger if exists production_failures_same_workspace on production_failures;
create trigger production_failures_same_workspace before insert or update on production_failures for each row
  execute function refuse_cross_workspace('agent_id', 'agents');

drop trigger if exists verdict_reviews_same_workspace_refs on verdict_reviews;
create trigger verdict_reviews_same_workspace_refs before insert or update on verdict_reviews for each row
  execute function refuse_cross_workspace('run_case_id', 'run_cases');
