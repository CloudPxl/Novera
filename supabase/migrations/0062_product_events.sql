-- First-party product events: how many people reach each step, never who they are.
--
-- Counts the steps between a visit and a sealed report (landing click, sign-up, a probed
-- agent, a saved policy, a run started and finished, a report viewed or shared, checkout)
-- so the funnel can be measured without a third-party tool and without personal data.
--
--   * The event name is one of a fixed list; a new event is a new migration.
--   * No user id, no email, no IP, no user agent, no report token. The actor is a salted
--     HMAC computed by the server (src/lib/analytics/track.ts) with a secret the database
--     does not hold, or null.
--   * Properties are a small flat object of coarse values, checked here as well as in the
--     application: no nested values, at most 1 KB, and nothing shaped like a key, a bearer
--     token, a JWT, an email, or a long opaque identifier (a report token, a UUID).
--   * Clients can neither read nor write it: RLS on with no policy and every grant revoked.
--     Only the service role inserts.
--   * Append-only, with three exits: workspace erasure, the erasure of one actor's events
--     when their account is deleted, and the 13-month retention pass.
--
-- Also, as every table that refuses deletion must: erase_workspace (0056's body exactly,
-- plus this table) and the daily expire_inbound_and_probes pass (0056's body exactly, plus
-- the 13-month delete) — the pattern 0054 and 0056 used, so no new cron job is needed.

create table if not exists product_events (
  id            bigint generated always as identity primary key,
  event         text not null check (event in (
                  'landing_cta_click', 'signup_started', 'signup_confirmed', 'agent_probed',
                  'policy_saved', 'run_created', 'run_completed', 'report_viewed',
                  'report_shared', 'billing_checkout_started', 'billing_checkout_completed')),
  workspace_id  uuid references workspaces (id) on delete cascade,
  actor_hash    text check (actor_hash ~ '^[0-9a-f]{64}$'),
  properties    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  constraint product_events_properties_shape check (
    jsonb_typeof(properties) = 'object'
    and octet_length(properties::text) <= 1024
    and not jsonb_path_exists(properties, '$.* ? (@.type() == "object" || @.type() == "array")')
  ),
  -- The same shapes src/lib/analytics/events.ts refuses, so a server bug cannot store one.
  constraint product_events_properties_no_secrets check (
    properties::text !~* '(sk-[a-z0-9_-]{6,}|sk_(live|test)_|rk_(live|test)_|gsk_|nvk_|whsec_|sb_secret_|bearer\s|eyJ[a-z0-9_-]{8,}|-----BEGIN|[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}|[a-z0-9_-]{32,})'
  )
);

create index if not exists product_events_event_time on product_events (event, created_at);
create index if not exists product_events_workspace_time on product_events (workspace_id, created_at) where workspace_id is not null;
create index if not exists product_events_actor on product_events (actor_hash) where actor_hash is not null;

alter table product_events enable row level security;
revoke all on table product_events from public, anon, authenticated;
revoke all on sequence product_events_id_seq from public, anon, authenticated;

comment on table product_events is
  'First-party funnel counts. Fixed event names, a salted actor hash (never a user id or email), '
  'coarse flat properties. Server inserts only; append-only; erased with the workspace or the '
  'account; deleted after 13 months.';

create or replace function product_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and (
    erasing_workspace() or erasing_account()
    or coalesce(current_setting('novera.expiring_product_events', true), '') = 'on'
  ) then
    return old;
  end if;
  raise exception 'Product events are append-only.';
end;
$$;
drop trigger if exists product_events_append_only on product_events;
create trigger product_events_append_only before update or delete on product_events
  for each row execute function product_events_append_only();

-- ------------------------------------------------------------------ account erasure
--
-- The hash is computed with a secret the database does not have, so `erase_account` cannot
-- find a person's events; the application computes the hash and calls this beside it
-- (src/lib/workflow/identity.ts, deleteAccount).
create or replace function erase_product_events_of_actor(actor text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if actor is null or actor !~ '^[0-9a-f]{64}$' then return 0; end if;
  perform set_config('novera.erasing_account', 'on', true);
  delete from product_events where actor_hash = actor;
  get diagnostics n = row_count;
  perform set_config('novera.erasing_account', 'off', true);
  return n;
end;
$$;
revoke all on function erase_product_events_of_actor(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ workspace erasure
--
-- 0056's body exactly, plus product_events beside the audit trail.

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

  -- 0054's tables first: they reference runs' neighbours only through the workspace.
  delete from assistant_memory_candidates where workspace_id = target;
  delete from assistant_memory      where workspace_id = target;
  delete from assistant_threads     where workspace_id = target;
  delete from workspace_invitations where workspace_id = target;
  delete from audit_events          where workspace_id = target;
  -- 0062: counts only, but they name the workspace.
  delete from product_events        where workspace_id = target;
  -- A profile pointing here loses the default, not the profile.
  update user_profiles set default_workspace_id = null where default_workspace_id = target;
  update user_profiles set default_agent_id = null
   where default_agent_id in (select id from agents where workspace_id = target);


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
  -- 0056: after the drafts that name them, before the agents and suites they name.
  delete from suite_obligations     where workspace_id = target;
  delete from suite_sources         where workspace_id = target;
  delete from suite_builds          where workspace_id = target;
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

-- ------------------------------------------------------------------ retention
--
-- 0056's body exactly, plus: product events older than 13 months are deleted. The daily job
-- (`novera-inbound-probe-expiry`, 0038) already calls this function.

create or replace function expire_inbound_and_probes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - interval '90 days';
  target uuid;
  n_requests integer := 0;
  n_probes integer;
  n_threads integer;
  n_memory integer;
  n_sources integer;
  n_events integer;
begin
  for target in
    select r.id from inbound_requests r
    where greatest(
      r.created_at,
      coalesce((select max(greatest(d.created_at, coalesce(d.approved_at, d.created_at), coalesce(d.sent_at, d.created_at)))
                from reply_drafts d where d.request_id = r.id), r.created_at)
    ) < cutoff
  loop
    perform erase_inbound_request(target, null, 'retention');
    n_requests := n_requests + 1;
  end loop;

  perform set_config('novera.expiring_raw', 'on', true);
  update probes
     set response_body = null, response_headers = null, response_shape = null, content_expired_at = now()
   where content_expired_at is null and created_at < cutoff;
  get diagnostics n_probes = row_count;
  update suite_sources
     set text = null, content_expired_at = now()
   where content_expired_at is null and text is not null and created_at < now() - interval '180 days';
  get diagnostics n_sources = row_count;
  perform set_config('novera.expiring_raw', 'off', true);

  delete from assistant_threads where last_message_at < now() - interval '180 days';
  get diagnostics n_threads = row_count;
  delete from assistant_memory where expires_at is not null and expires_at < now();
  get diagnostics n_memory = row_count;

  perform set_config('novera.expiring_product_events', 'on', true);
  delete from product_events where created_at < now() - interval '13 months';
  get diagnostics n_events = row_count;
  perform set_config('novera.expiring_product_events', 'off', true);

  return jsonb_build_object('requests', n_requests, 'probes', n_probes, 'assistant_threads', n_threads,
                            'assistant_memory', n_memory, 'suite_sources', n_sources, 'product_events', n_events);
end;
$$;
