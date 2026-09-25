-- A person's reading of a verdict, kept beside it and never in place of it.
--
-- Prospecting found this missing in every direction at once: LangSmith, Opik and Maxim
-- all route verdicts to a person, and LangSmith derives an "alignment score" — how often
-- the judge agreed with the human — from exactly that. Novera had no way for anyone to
-- say "this verdict is wrong". A disputed case could only be rerun, and an operator who
-- disagreed with a finding had nowhere to record it except outside the product.
--
-- The design is shaped by the one thing that could make this dangerous. The operator is
-- usually the agency whose agent was tested; a review that *replaced* a verdict would let
-- them quietly turn a failure into a pass before a client saw it. So:
--
--   - The verdict is never touched. A review is its own row, and a report shows both.
--   - The review freezes the verdict it was reviewing, so "the person agreed" still means
--     something if the case is later retested.
--   - A reason is required. A disagreement with no reason is an assertion, not evidence.
--   - Append-only. A changed mind is a second review; the first stays.
--
-- Whether a person's finding should ever count in the *score* is a separate decision and
-- is deliberately not taken here. Today it counts nowhere; it is shown.

create table if not exists verdict_reviews (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces (id) on delete cascade,
  run_case_id    uuid not null references run_cases (id) on delete cascade,
  reviewer_id    uuid not null references auth.users (id),
  -- What the models or rules had found when the person read it. Frozen, so a review
  -- stays legible whatever happens to the case afterwards.
  verdict_status text not null check (verdict_status in ('pass', 'fail', 'error')),
  -- The person's own finding. There is no "error": a person who cannot decide has not
  -- reviewed it.
  finding        text not null check (finding in ('pass', 'fail')),
  note           text not null check (char_length(btrim(note)) between 10 and 2000),
  created_at     timestamptz not null default now()
);

create index if not exists verdict_reviews_case_idx on verdict_reviews (run_case_id, created_at desc);
create index if not exists verdict_reviews_workspace_idx on verdict_reviews (workspace_id, created_at desc);

alter table verdict_reviews enable row level security;

drop policy if exists verdict_reviews_select on verdict_reviews;
create policy verdict_reviews_select on verdict_reviews for select
  using (is_workspace_member(workspace_id));

-- A review must be about a case in the reviewer's own workspace. Checked in the
-- database so the service role cannot attach one workspace's review to another's case.
create or replace function verdict_reviews_same_workspace()
returns trigger language plpgsql as $$
declare
  owner uuid;
begin
  select workspace_id into owner from run_cases where id = new.run_case_id;
  if owner is distinct from new.workspace_id then
    raise exception 'A review must belong to the workspace of the case it reviews';
  end if;
  return new;
end;
$$;

drop trigger if exists verdict_reviews_same_workspace on verdict_reviews;
create trigger verdict_reviews_same_workspace before insert on verdict_reviews
  for each row execute function verdict_reviews_same_workspace();

drop trigger if exists verdict_reviews_immutable on verdict_reviews;
create trigger verdict_reviews_immutable before update or delete on verdict_reviews
  for each row execute function refuse_mutation();

comment on table verdict_reviews is
  'A person''s finding on a verdict, beside it and never replacing it. Freezes the verdict '
  'reviewed; requires a reason; append-only. Counts in no score. Reachable for deletion '
  'only by erase_workspace().';

-- Every table that refuses deletion needs an erasure path designed alongside it.
-- Eighth time (0005, 0007, 0010, 0013, 0020, 0022, and here).
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
