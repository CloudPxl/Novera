-- Re-testing one scenario after a policy change, without pretending it was a run.
--
-- The obvious implementation — write it to `runs` and `run_cases` — would corrupt two
-- things at once: coverage (a "run" containing one case) and baseline comparison (the
-- most recent completed run becomes a single-case run). A report is always a whole
-- suite against one policy version, and nothing here is ever allowed to change that.
--
-- So a retest is its own kind of evidence: stored, append-only, visible to the
-- operator, and never counted in a score or published in a report. It answers "did my
-- fix work?" in seconds without spending a full suite run, and the full run is still
-- what produces the document.

create table case_retests (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  -- The original graded case this is re-testing, so the before/after is unambiguous.
  run_case_id   uuid not null references run_cases (id) on delete cascade,
  -- The policy version the retest was executed against, which is the whole point:
  -- it is normally a newer version than the one the original case was graded under.
  policy_id     uuid not null references policies (id) on delete restrict,
  response_text text,
  status        text not null check (status in ('pass', 'fail', 'error')),
  rationale     text,
  failed_assertions jsonb not null default '[]'::jsonb,
  judge_model   text,
  judge_votes   jsonb not null default '[]'::jsonb,
  judge_agreement text,
  latency_ms    integer,
  error         text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now()
);
create index on case_retests (run_case_id, created_at desc);
create index on case_retests (workspace_id);

alter table case_retests enable row level security;
create policy case_retests_select on case_retests for select
  using (is_workspace_member(workspace_id));

-- Append-only, like every other piece of evidence.
create trigger case_retests_immutable before update or delete on case_retests
  for each row execute function refuse_mutation();

comment on table case_retests is
  'A single scenario re-executed against a newer policy version. Never counted in a '
  'score and never published in a report; a report is always a whole suite.';

-- Every table that refuses deletion needs an erasure path designed alongside it.
-- Learned four times now (0005, 0007, 0010, and here) — so this is not an afterthought.
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

  delete from reports      where workspace_id = target;
  delete from diagnoses    where workspace_id = target;
  delete from case_retests where workspace_id = target;
  delete from run_cases    where workspace_id = target;
  delete from runs         where workspace_id = target;
  delete from probes       where workspace_id = target;
  delete from policies     where workspace_id = target;
  delete from secrets      where workspace_id = target;
  delete from agents       where workspace_id = target;
  delete from suites       where workspace_id = target;
  delete from workspace_members where workspace_id = target;
  delete from workspaces   where id = target;

  perform set_config('novera.erasing', 'off', true);

  insert into erasure_log (workspace_id, requested_by, agents_removed, runs_removed, cases_removed, reports_removed)
  values (target, requested_by, n_agents, n_runs, n_cases, n_reports)
  returning * into record;

  return record;
end;
$$;

revoke execute on function erase_workspace(uuid, uuid) from anon, authenticated;
