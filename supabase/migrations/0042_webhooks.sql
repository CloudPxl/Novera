-- Outbound webhooks: Novera tells a customer's system when something happened, so an
-- agency's pipeline, chat or ticketing hears about a finished run without polling.
--
-- An endpoint is where to send and which events. Its signing secret is shown once and
-- kept sealed on the row (the same AES-GCM sealing as model keys, bound to the
-- endpoint's id), so a delivery can be signed and a receiver can check it came from
-- Novera. Like an API key, an endpoint cannot be edited — only revoked, for good.
--
-- A delivery is one event for one endpoint, with its body frozen at enqueue and every
-- attempt counted. The body carries counts, the outcome and the report link — never a
-- transcript, a reply, a policy or a credential. One delivery per endpoint, event and
-- subject, so a run that finishes is announced once however many slices report it.

create table if not exists webhook_endpoints (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces (id) on delete cascade,
  url              text not null check (url ~ '^https?://'),
  events           text[] not null check (
                     cardinality(events) > 0
                     and events <@ array['run.completed', 'run.stopped', 'schedule.paused']),
  secret_prefix    text not null,
  secret_ciphertext text not null,
  secret_iv        text not null,
  secret_tag       text not null,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users (id)
);
create index if not exists webhook_endpoints_workspace_idx on webhook_endpoints (workspace_id, created_at desc);

alter table webhook_endpoints enable row level security;
drop policy if exists webhook_endpoints_select on webhook_endpoints;
create policy webhook_endpoints_select on webhook_endpoints for select
  using (is_workspace_member(workspace_id));
-- The sealed secret never reaches a browser; members read everything else.
revoke select on webhook_endpoints from anon, authenticated;
grant select (id, workspace_id, url, events, secret_prefix, created_by, created_at, revoked_at, revoked_by)
  on webhook_endpoints to authenticated;

create or replace function webhook_endpoints_revoke_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A webhook endpoint cannot be deleted; revoke it, which records who and when';
  end if;
  if (to_jsonb(new) - array['revoked_at', 'revoked_by']) is distinct from (to_jsonb(old) - array['revoked_at', 'revoked_by']) then
    raise exception 'A webhook endpoint cannot be changed; revoke it and add another';
  end if;
  if old.revoked_at is not null then
    raise exception 'A revoked webhook endpoint stays revoked';
  end if;
  return new;
end;
$$;
drop trigger if exists webhook_endpoints_revoke_only on webhook_endpoints;
create trigger webhook_endpoints_revoke_only before update or delete on webhook_endpoints
  for each row execute function webhook_endpoints_revoke_only();

create table if not exists webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  endpoint_id     uuid not null references webhook_endpoints (id) on delete restrict,
  event           text not null check (event in ('run.completed', 'run.stopped', 'schedule.paused', 'test')),
  -- The run or schedule the event is about; null for a test event.
  subject_id      uuid,
  body            jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts        integer not null default 0,
  last_status     integer,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);
create unique index if not exists webhook_deliveries_once on webhook_deliveries (endpoint_id, event, subject_id);
create index if not exists webhook_deliveries_due on webhook_deliveries (next_attempt_at) where status = 'pending';

alter table webhook_deliveries enable row level security;
drop policy if exists webhook_deliveries_select on webhook_deliveries;
create policy webhook_deliveries_select on webhook_deliveries for select
  using (is_workspace_member(workspace_id));

-- What was sent is frozen; only the delivery's own bookkeeping moves, and a delivery
-- that succeeded or gave up stays that way.
create or replace function webhook_deliveries_guard()
returns trigger language plpgsql as $$
declare
  moving text[] := array['status', 'attempts', 'last_status', 'last_error', 'next_attempt_at', 'delivered_at'];
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A webhook delivery cannot be deleted';
  end if;
  if (to_jsonb(new) - moving) is distinct from (to_jsonb(old) - moving) then
    raise exception 'What a webhook delivery sent cannot be changed';
  end if;
  if old.status <> 'pending' then
    raise exception 'A webhook delivery that was % is final', old.status;
  end if;
  return new;
end;
$$;
drop trigger if exists webhook_deliveries_guard on webhook_deliveries;
create trigger webhook_deliveries_guard before update or delete on webhook_deliveries
  for each row execute function webhook_deliveries_guard();

drop trigger if exists webhook_deliveries_same_workspace on webhook_deliveries;
create trigger webhook_deliveries_same_workspace before insert or update on webhook_deliveries for each row
  execute function refuse_cross_workspace('endpoint_id', 'webhook_endpoints');

-- Every table that refuses deletion ships with its erasure path.
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

  -- Before the endpoints they belong to.
  delete from webhook_deliveries    where workspace_id = target;
  delete from webhook_endpoints     where workspace_id = target;
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

revoke execute on function erase_workspace(uuid, uuid) from public, anon, authenticated;
