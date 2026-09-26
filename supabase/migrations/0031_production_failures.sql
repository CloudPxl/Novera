-- A failure seen in production, turned into a regression scenario.
--
-- The most valuable test case there is, and the one most likely to contain a real
-- customer's details. Three rules, each enforced here rather than trusted to the code:
--
--  1. Only redacted text is stored. The original is represented by its SHA-256, which
--     proves which text a scenario came from without keeping it (redaction policy and
--     counts in `redaction`).
--  2. A failure is a record of something that happened: append-only. What the person
--     wants to happen instead is part of that record, frozen with it.
--  3. It reaches a suite only as a scenario draft (origin 'production'), through the
--     same named approval as every other draft (0022). The draft names its failure, so
--     the link between a regression case and the incident it guards against is
--     permanent. Where a failure is in its life — drafted, approved, in a suite, run
--     since, came back — is derived from those rows, never stored a second time.

create table if not exists production_failures (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces (id) on delete cascade,
  agent_id           uuid references agents (id) on delete restrict,
  customer_message   text not null check (length(btrim(customer_message)) > 0),
  agent_reply        text,
  expected_behavior  text not null check (length(btrim(expected_behavior)) > 0),
  what_went_wrong    text,
  occurred_on        date,
  redaction          jsonb not null
                     check (redaction ? 'policy_version' and redaction ? 'original_hash' and redaction ? 'redacted_hash'),
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now()
);

create index if not exists production_failures_workspace_idx on production_failures (workspace_id, created_at desc);

alter table production_failures enable row level security;

drop policy if exists production_failures_select on production_failures;
create policy production_failures_select on production_failures for select
  using (is_workspace_member(workspace_id));

drop policy if exists production_failures_insert on production_failures;
create policy production_failures_insert on production_failures for insert
  with check (is_workspace_member(workspace_id));

-- Append-only, for the service role too; erasure is the one way out.
drop trigger if exists production_failures_immutable on production_failures;
create trigger production_failures_immutable before update or delete on production_failures
  for each row execute function refuse_mutation();

comment on table production_failures is
  'A failure seen in production, stored redacted (original kept only as a SHA-256). '
  'Append-only. Becomes a regression scenario only as a scenario draft a person approves. '
  'Reachable for deletion only by erase_workspace().';

-- The third origin of a draft. Each origin carries its own proof and cannot borrow
-- another's: a policy draft its quoted passage, an import its file and item hashes, a
-- regression the failure it came from.
alter table scenario_drafts
  add column if not exists production_failure_id uuid references production_failures (id) on delete restrict;

alter table scenario_drafts drop constraint if exists scenario_drafts_origin_check;
alter table scenario_drafts add constraint scenario_drafts_origin_check
  check (origin in ('policy', 'import', 'production'));

alter table scenario_drafts drop constraint if exists scenario_drafts_origin_proof;
alter table scenario_drafts add constraint scenario_drafts_origin_proof check (
  (origin = 'policy' and policy_id is not null and source_quote is not null
     and import_provenance is null and production_failure_id is null)
  or
  (origin = 'import' and policy_id is null and source_quote is null and production_failure_id is null
     and import_provenance is not null
     and import_provenance ? 'source_tool'
     and import_provenance ? 'original_hash'
     and import_provenance ? 'item_hash')
  or
  (origin = 'production' and production_failure_id is not null
     and policy_id is null and source_quote is null and import_provenance is null)
);

create index if not exists scenario_drafts_failure_idx on scenario_drafts (production_failure_id)
  where production_failure_id is not null;

-- The forward-only rule, now also freezing which failure a draft came from.
create or replace function scenario_drafts_forward_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A scenario draft cannot be deleted; reject it, which records who and why';
  end if;

  if new.scenario is distinct from old.scenario
  or new.source_quote is distinct from old.source_quote
  or new.policy_id is distinct from old.policy_id
  or new.destructive is distinct from old.destructive
  or new.fixture_only is distinct from old.fixture_only
  or new.origin is distinct from old.origin
  or new.import_provenance is distinct from old.import_provenance
  or new.production_failure_id is distinct from old.production_failure_id
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

-- Every table that refuses deletion needs an erasure path designed alongside it.
-- Ninth time (0005, 0007, 0010, 0013, 0020, 0022, 0028, and here).
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
