-- Reading the customer's own system to find out whether an action actually happened.
--
-- A tool call is not an effect and a tool response is not a durable state change.
-- Until now `state_confirmed` was withheld in every case, because nothing could look.
-- An observation is what looking produced, and it is evidence in its own right: it
-- has to survive, be attributable, and never be quietly rewritten.

-- Where to look, per agent. Null for every agent that has none, which is all of them
-- until a customer configures one — and the report says "unverified", not "passed".
alter table agents add column if not exists verification jsonb;

comment on column agents.verification is
  'Read-only verification endpoint for confirming that a claimed action changed state. GET only by construction; a credential for it lives in secrets under scope verification_auth, never here.';

create table if not exists evidence_observations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  -- The case whose claimed effect this was looking for.
  run_case_id   uuid not null references run_cases (id) on delete cascade,
  connector     text not null,
  connector_version text not null,
  -- read_only today, always. A connector that can write is a second actor in the
  -- test, and the column exists so that stays visible rather than implicit.
  mode          text not null check (mode in ('read_only', 'test_write')),
  status        text not null check (status in ('confirmed', 'contradicted', 'unavailable')),
  -- One sentence, already redacted. The read-back body itself is never stored: it is
  -- the customer's data, and this row is quoted into a client-facing report.
  detail        text not null,
  -- What was actually looked for, so "confirmed" is not taken on trust.
  checked       jsonb not null default '[]'::jsonb,
  latency_ms    integer,
  created_at    timestamptz not null default now()
);
create index if not exists evidence_observations_case_idx on evidence_observations (run_case_id, created_at desc);
create index if not exists evidence_observations_workspace_idx on evidence_observations (workspace_id);

alter table evidence_observations enable row level security;
drop policy if exists evidence_observations_select on evidence_observations;
create policy evidence_observations_select on evidence_observations for select
  using (is_workspace_member(workspace_id));

-- Append-only, like every other piece of evidence.
drop trigger if exists evidence_observations_immutable on evidence_observations;
create trigger evidence_observations_immutable before update or delete on evidence_observations
  for each row execute function refuse_mutation();

comment on table evidence_observations is
  'What an independent read of the customer''s own system showed about a claimed action. Append-only; reachable only by erase_workspace().';

-- Every table that refuses deletion needs an erasure path designed alongside it.
-- Five times now (0005, 0007, 0010, 0013, and here), so it is written in the same
-- migration rather than remembered later.
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

  delete from reports              where workspace_id = target;
  delete from diagnoses            where workspace_id = target;
  delete from case_retests         where workspace_id = target;
  delete from evidence_observations where workspace_id = target;
  delete from run_cases            where workspace_id = target;
  delete from runs                 where workspace_id = target;
  delete from probes               where workspace_id = target;
  delete from policies             where workspace_id = target;
  delete from secrets              where workspace_id = target;
  delete from agents               where workspace_id = target;
  delete from suites               where workspace_id = target;
  delete from workspace_members    where workspace_id = target;
  delete from workspaces           where id = target;

  perform set_config('novera.erasing', 'off', true);

  insert into erasure_log (workspace_id, requested_by, agents_removed, runs_removed, cases_removed, reports_removed)
  values (target, requested_by, n_agents, n_runs, n_cases, n_reports)
  returning * into record;

  return record;
end;
$$;

revoke execute on function erase_workspace(uuid, uuid) from anon, authenticated;

-- A read-back that could not be reached is its own kind of gap, distinct from having
-- no read-back configured at all: one is a broken connection, the other is a product
-- we have not been asked to verify.
alter table run_cases drop constraint if exists run_cases_evidence_gap_check;
alter table run_cases add constraint run_cases_evidence_gap_check
  check (evidence_gap is null or evidence_gap in ('no_tool_evidence', 'no_state_evidence', 'read_back_unavailable'));

alter table case_retests drop constraint if exists case_retests_evidence_gap_check;
alter table case_retests add constraint case_retests_evidence_gap_check
  check (evidence_gap is null or evidence_gap in ('no_tool_evidence', 'no_state_evidence', 'read_back_unavailable'));

-- A case the read-back settled was decided by neither a rule in the scenario nor the
-- models, and saying either would misdescribe the strongest finding this product can
-- produce.
alter table run_cases drop constraint if exists run_cases_settled_by_check;
alter table run_cases add constraint run_cases_settled_by_check
  check (settled_by is null or settled_by in ('deterministic', 'models', 'read_back'));

alter table case_retests drop constraint if exists case_retests_settled_by_check;
alter table case_retests add constraint case_retests_settled_by_check
  check (settled_by is null or settled_by in ('deterministic', 'models', 'read_back'));

-- A read-back-settled case was not graded by a model either.
alter table run_cases drop constraint if exists run_cases_rule_settled_has_no_judge;
alter table run_cases add constraint run_cases_rule_settled_has_no_judge
  check (settled_by not in ('deterministic', 'read_back') or (judge_model is null and judge_agreement is null));
