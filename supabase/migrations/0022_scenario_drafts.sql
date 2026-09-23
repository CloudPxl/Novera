-- Turning a customer's written policy into scenarios, without letting a model decide
-- what a customer is tested against.
--
-- The value of a Novera report rests on being able to answer "why is this case in my
-- report". A scenario a model wrote and nobody read cannot answer it. So a drafted
-- scenario is not a scenario: it is a proposal, it names the exact passage of the
-- policy it exists to test, and a person approves it before it can enter a suite
-- version. The same discipline as a diagnosis (0007), applied to the input side.
--
-- One table, not the two the plan sketched. An approval is a state transition with a
-- name and a time on it, exactly as `reply_drafts` (0009) records one. A separate
-- approvals table would be a second place for the same fact to live, and therefore a
-- second place for it to be wrong.

create table if not exists scenario_drafts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces (id) on delete cascade,
  agent_id       uuid references agents (id) on delete cascade,
  -- The exact policy version this was drafted from. Policies are immutable, so this
  -- says precisely which words produced the proposal, forever.
  policy_id      uuid not null references policies (id) on delete restrict,
  -- The passage of that policy the scenario tests, in the policy's own wording. Not
  -- the model's paraphrase: located in the policy text before the row is written, and
  -- a draft whose quote is not in the policy is refused rather than repaired.
  source_quote   text not null,
  -- The scenario itself, in the same shape a suite case has. Validated by the same
  -- validator the importer and the seeder use, so a draft that could never run cannot
  -- be stored looking like one that could.
  scenario       jsonb not null,
  duty_refs      jsonb not null default '[]'::jsonb,
  risk_level     text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  -- Load-bearing, both of them. `destructive` means running it attempts something
  -- irreversible; `fixture_only` means it is written against scripted data that is
  -- not real. Either one bars the case from a production agent (see agents.is_production).
  destructive    boolean not null default false,
  fixture_only   boolean not null default false,
  model          text,
  status         text not null default 'draft'
                 check (status in ('draft', 'approved', 'rejected', 'included')),
  approved_by    uuid references auth.users (id),
  approved_at    timestamptz,
  rejected_by    uuid references auth.users (id),
  rejected_at    timestamptz,
  -- Required on a rejection. A rejection with no reason teaches the next draft nothing.
  rejection_reason text,
  included_in_suite_id uuid references suites (id) on delete restrict,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now()
);

create index if not exists scenario_drafts_workspace_idx on scenario_drafts (workspace_id, created_at desc);
create index if not exists scenario_drafts_policy_idx on scenario_drafts (policy_id);
create index if not exists scenario_drafts_status_idx on scenario_drafts (workspace_id, status);

alter table scenario_drafts enable row level security;

drop policy if exists scenario_drafts_select on scenario_drafts;
create policy scenario_drafts_select on scenario_drafts for select
  using (is_workspace_member(workspace_id));

drop policy if exists scenario_drafts_insert on scenario_drafts;
create policy scenario_drafts_insert on scenario_drafts for insert
  with check (is_workspace_member(workspace_id));

drop policy if exists scenario_drafts_update on scenario_drafts;
create policy scenario_drafts_update on scenario_drafts for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- The rule this whole phase exists for: nothing a model wrote reaches a suite without
-- a person's name on it, and once it is in a suite it stops moving.
create or replace function scenario_drafts_forward_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A scenario draft cannot be deleted; reject it, which records who and why';
  end if;

  -- Frozen at insert. Editing a draft means writing another one, so what a person
  -- approved is always what they read.
  if new.scenario is distinct from old.scenario
  or new.source_quote is distinct from old.source_quote
  or new.policy_id is distinct from old.policy_id
  or new.destructive is distinct from old.destructive
  or new.fixture_only is distinct from old.fixture_only
  or new.created_at is distinct from old.created_at then
    raise exception 'A scenario draft is immutable; write a new draft instead of editing this one';
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'approved', 'rejected') then
    raise exception 'A draft becomes approved or rejected, not %', new.status;
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'included') then
    raise exception 'An approved draft cannot return to %', new.status;
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'A rejected draft cannot be revived; draft a new one';
  end if;
  if old.status = 'included' and new.status <> 'included' then
    raise exception 'A scenario already in a suite version cannot be withdrawn from it';
  end if;

  if new.status = 'approved' and (new.approved_by is null or new.approved_at is null) then
    raise exception 'An approval must record who made it and when';
  end if;
  if new.status = 'rejected' and (new.rejected_by is null or new.rejected_at is null
                                  or coalesce(btrim(new.rejection_reason), '') = '') then
    raise exception 'A rejection must record who made it, when, and why';
  end if;
  if new.status = 'included' and new.included_in_suite_id is null then
    raise exception 'A draft marked as included must name the suite version it entered';
  end if;

  return new;
end;
$$;

drop trigger if exists scenario_drafts_forward_only on scenario_drafts;
create trigger scenario_drafts_forward_only before update or delete on scenario_drafts
  for each row execute function scenario_drafts_forward_only();

comment on table scenario_drafts is
  'Scenarios drafted from a policy version by a model. A draft cannot run. Text frozen '
  'at insert; draft -> approved -> included, or draft -> rejected with a reason; a '
  'person''s name is on every approval. Reachable for deletion only by erase_workspace().';

-- A scenario that attempts something irreversible, or that is written against scripted
-- data, must not run against a live agent by accident. The agent says which it is, and
-- the default is the cautious one: every agent already registered is treated as
-- production until someone says otherwise.
alter table agents add column if not exists is_production boolean not null default true;

comment on column agents.is_production is
  'False only for agents that are test targets. A destructive or fixture-only scenario '
  'is recorded as not run against a production agent, never executed against one.';

-- Every table that refuses deletion needs an erasure path designed alongside it.
-- Seven times now (0005, 0007, 0010, 0013, 0020, and here), so it is written in the
-- same migration rather than remembered later.
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
  delete from run_cases             where workspace_id = target;
  delete from runs                  where workspace_id = target;
  delete from probes                where workspace_id = target;
  -- Before policies and suites: a draft references both, and a restricted reference
  -- would otherwise make an authorised erasure fail at the last step.
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
