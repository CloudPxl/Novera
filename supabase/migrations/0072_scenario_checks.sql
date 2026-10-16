-- Single-scenario checks, and how long a webhook receiver took to answer.
--
-- 1. A single-scenario check is what a retest always was — one scenario sent to one agent and
--    graded by `executeCase`, exactly as a run grades it — generalised to start from either a
--    stored run case (the retest) or a scenario of a suite (the catalog, `POST
--    /api/v1/probes/single`). It is not a run: it is stored in `case_retests`, never in `runs`
--    or `run_cases`, so it cannot reach a score, a coverage figure, a baseline, a report or the
--    trial's run count. The table keeps every rule it had: append-only (0013), the same verdict
--    invariants as a run case (0015, 0017, 0019, 0020), the raw-evidence fingerprint and the
--    retention pass (0037 empties `response_text` and `transcript` by workspace, which covers
--    the new rows with no change), member read, server write.
--     * `run_case_id` becomes optional; a check of a suite scenario names its agent, suite and
--       scenario id instead, and a check from a run case may name them too.
--     * A check started through the API names its key; `responses_returned` records, on the
--       row itself and at the moment it is written, that the agent's reply was handed to that
--       key in the answer — the same disclosure 0050 records for a run read.
--     * `judge_source` is what funded the grading, as a run would have been stamped (0067).
--     * `read_back` keeps what the read-back of the customer's system showed (status and one
--       redacted sentence), which a retest used to drop.
--     * Every new reference stays inside the workspace (0034); a built-in suite is shared.
--     * Erasure: erase_workspace() already deletes case_retests before the agents, suites,
--       policies and keys these columns name, so its body does not change.
--
-- 2. `scenario_check_slots`: 20 checks per workspace in any rolling hour, counted under a
--    per-workspace lock so racing requests cannot all read 19. A slot is taken just before the
--    scenario is sent; a refusal says when the oldest slot in the window expires. Bookkeeping,
--    not evidence: service role only, pruned as it goes, and erased with its workspace by the
--    cascade from `workspaces` (erase_workspace() deletes that row last).
--
-- 3. `webhook_deliveries.last_latency_ms`: how long the receiver took to answer the last
--    attempt. It moves with the attempt, like `last_status`, so the guard's list of moving
--    columns gains it and everything a delivery sent stays frozen.

-- 1. Single-scenario checks ------------------------------------------------------------------

alter table case_retests alter column run_case_id drop not null;

alter table case_retests
  add column if not exists origin             text not null default 'run_case',
  add column if not exists agent_id           uuid references agents (id),
  add column if not exists suite_id           uuid references suites (id),
  add column if not exists case_id            text,
  add column if not exists locale             text,
  add column if not exists api_key_id         uuid references api_keys (id),
  add column if not exists judge_source       text,
  add column if not exists responses_returned boolean not null default false,
  add column if not exists read_back          jsonb;

alter table case_retests drop constraint if exists case_retests_origin_check;
alter table case_retests add constraint case_retests_origin_check check (
  (origin = 'run_case' and run_case_id is not null)
  or (origin = 'suite_case' and run_case_id is null and agent_id is not null and suite_id is not null and case_id is not null)
);
alter table case_retests drop constraint if exists case_retests_case_id_shape;
alter table case_retests add constraint case_retests_case_id_shape
  check (case_id is null or (length(case_id) between 1 and 100 and case_id !~ '[[:cntrl:]]'));
alter table case_retests drop constraint if exists case_retests_locale_check;
alter table case_retests add constraint case_retests_locale_check
  check (locale is null or locale in ('en', 'de', 'fr', 'ro'));
alter table case_retests drop constraint if exists case_retests_judge_source_check;
alter table case_retests add constraint case_retests_judge_source_check
  check (judge_source is null or judge_source in ('trial_free', 'workspace_key', 'plan_managed'));
-- The reply is handed over only to a key that asked for it: never to a person's click.
alter table case_retests drop constraint if exists case_retests_responses_need_key;
alter table case_retests add constraint case_retests_responses_need_key
  check (not responses_returned or api_key_id is not null);

-- What the read-back of the customer's own system showed: its status and one redacted
-- sentence, as a run stores it in evidence_observations. Never the response body.
alter table case_retests drop constraint if exists case_retests_read_back_shape;
alter table case_retests add constraint case_retests_read_back_shape check (
  read_back is null or (jsonb_typeof(read_back) = 'object'
    and read_back ->> 'status' in ('confirmed', 'contradicted', 'unavailable')));

create index if not exists case_retests_by_scenario
  on case_retests (workspace_id, agent_id, suite_id, case_id, created_at desc)
  where agent_id is not null;

drop trigger if exists case_retests_same_workspace on case_retests;
create trigger case_retests_same_workspace before insert or update on case_retests for each row
  execute function refuse_cross_workspace(
    'run_case_id', 'run_cases', 'policy_id', 'policies', 'agent_id', 'agents',
    'suite_id', 'suites', 'api_key_id', 'api_keys');

revoke insert, update, delete, truncate on table case_retests from public, anon, authenticated;

comment on table case_retests is
  'Single-scenario checks: one scenario, from a stored run case or a suite, sent to one agent and '
  'graded as a run grades it. Never a run: never counted in a score, a coverage figure, a baseline '
  'or the trial, and never published in a report. Append-only; raw reply emptied by the retention pass.';
comment on column case_retests.origin is
  'run_case: re-sends a stored run case (run_case_id). suite_case: a suite scenario by agent, suite and case id.';
comment on column case_retests.responses_returned is
  'True when the agent''s reply was returned to the API key named in api_key_id, which asked for it '
  'with the responses scope. Written once, with the row.';

-- 2. The rolling-hour limit -----------------------------------------------------------------

create table if not exists scenario_check_slots (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  taken_at     timestamptz not null default now()
);
create index if not exists scenario_check_slots_window on scenario_check_slots (workspace_id, taken_at);

alter table scenario_check_slots enable row level security;
revoke all on table scenario_check_slots from public, anon, authenticated;

comment on table scenario_check_slots is
  'One row per single-scenario check started, for the rolling-hour limit. Bookkeeping, not '
  'evidence: service role only, pruned past the window, erased with the workspace by cascade.';

-- Takes one slot for a workspace if fewer than `max_checks` were taken in the last
-- `window_seconds`. One transaction-scoped lock per workspace, so concurrent requests are
-- counted one after another and the limit holds however many arrive at once.
-- `resets_at` is when the oldest slot in the window expires: when one more will be allowed.
create or replace function take_scenario_check_slot(p_workspace uuid, max_checks integer, window_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
  oldest timestamptz;
begin
  if max_checks is null or max_checks < 1 or window_seconds is null or window_seconds < 1 then
    raise exception 'A check limit needs a positive count and window';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('scenario-check:' || p_workspace::text, 0));

  delete from scenario_check_slots
   where workspace_id = p_workspace and taken_at <= now() - make_interval(secs => window_seconds);

  select count(*), min(taken_at) into used, oldest
    from scenario_check_slots where workspace_id = p_workspace;

  if used >= max_checks then
    return jsonb_build_object(
      'allowed', false, 'used', used, 'remaining', 0,
      'resets_at', oldest + make_interval(secs => window_seconds));
  end if;

  insert into scenario_check_slots (workspace_id) values (p_workspace);
  return jsonb_build_object(
    'allowed', true, 'used', used + 1, 'remaining', max_checks - used - 1,
    'resets_at', coalesce(oldest, now()) + make_interval(secs => window_seconds));
end;
$$;

revoke execute on function take_scenario_check_slot(uuid, integer, integer) from public, anon, authenticated;
grant execute on function take_scenario_check_slot(uuid, integer, integer) to service_role;

-- 3. Webhook latency ------------------------------------------------------------------------

alter table webhook_deliveries add column if not exists last_latency_ms integer;
alter table webhook_deliveries drop constraint if exists webhook_deliveries_latency_check;
alter table webhook_deliveries add constraint webhook_deliveries_latency_check
  check (last_latency_ms is null or last_latency_ms >= 0);
comment on column webhook_deliveries.last_latency_ms is
  'Milliseconds from sending the last attempt to the receiver''s answer (or to giving up waiting). '
  'Null when the attempt was not sent.';

-- 0046's guard, with the one new moving column. Everything a delivery sent stays frozen.
create or replace function webhook_deliveries_guard()
returns trigger language plpgsql as $$
declare
  moving text[] := array['status', 'attempts', 'last_status', 'last_error', 'last_latency_ms', 'next_attempt_at', 'delivered_at', 'lease_token', 'lease_until'];
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
