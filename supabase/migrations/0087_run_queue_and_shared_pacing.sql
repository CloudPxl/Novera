-- 0087: a fair queue for grading slots, and model pacing shared by every slice (2026-11-13).
--
-- Three runs started together on 2026-11-13 stalled: two crawled at five or six scenarios a slice
-- and the third never started. Three causes, all Novera's:
--   1. Each slice paced Groq on its own (eight calls a minute), so two slices sent sixteen against
--      a limit of eight, met 429s and waited.
--   2. Two grading slots for every run on Novera's keys, claimed by whoever asked first: a third
--      run waited with no place in any line and nothing saying how long.
--   3. Only an open run page asked for the next slice.
-- This migration fixes the first two in the database; the application fixes the third. Every
-- function here is new: the application calls them when they exist and falls back to 0067's claim
-- and its own pacing when they do not, so it can be deployed before this is applied.

-- 1. Pacing. One row per model on Novera's paced connections (`groq/openai/gpt-oss-20b`): the
-- earliest moment its next call may start. No workspace data, so no erasure path is needed.
create table if not exists model_rate_slots (
  model_key text primary key check (char_length(model_key) between 1 and 160),
  next_at   timestamptz not null
);
alter table model_rate_slots enable row level security;
revoke all on model_rate_slots from public, anon, authenticated;
comment on table model_rate_slots is
  'When each paced model on Novera''s own keys may next be called, shared by every run slice (0087). Holds no workspace data.';

-- Reserves the model's next slot and returns how many milliseconds to wait for it, or -1 when that
-- slot is further away than the caller can wait (nothing is reserved then). One statement under a
-- row lock, so two slices asking together get two different slots.
create or replace function reserve_model_slot(slot_key text, interval_ms integer, max_wait_ms integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz;
  slot timestamptz;
  wait_ms integer;
begin
  if interval_ms is null or interval_ms <= 0 then
    return 0;
  end if;
  if slot_key is null or char_length(slot_key) not between 1 and 160 then
    raise exception 'A model key is 1 to 160 characters';
  end if;
  insert into model_rate_slots (model_key, next_at) values (slot_key, clock_timestamp())
    on conflict (model_key) do nothing;
  perform 1 from model_rate_slots where model_key = slot_key for update;
  t := clock_timestamp();
  select greatest(next_at, t) into slot from model_rate_slots where model_key = slot_key;
  wait_ms := ceil(extract(epoch from (slot - t)) * 1000)::integer;
  if wait_ms > greatest(coalesce(max_wait_ms, 0), 0) then
    return -1;
  end if;
  update model_rate_slots
     set next_at = slot + make_interval(secs => least(interval_ms, 600000) / 1000.0)
   where model_key = slot_key;
  return wait_ms;
end;
$$;

revoke execute on function reserve_model_slot(text, integer, integer) from public, anon, authenticated;
grant execute on function reserve_model_slot(text, integer, integer) to service_role;

-- 2. The queue. A run that asked for a slice and was told to wait keeps its place: when it first
-- waited, and when it last asked. A run nobody has asked for in two minutes leaves the line (it
-- keeps its `waiting_since`, so it rejoins where it was), so a closed tab never blocks anyone.
alter table runs add column if not exists waiting_since timestamptz;
alter table runs add column if not exists waiting_seen_at timestamptz;
comment on column runs.waiting_since is 'When this run first waited for a grading slot or for its agent; cleared when a slice starts (0087).';
comment on column runs.waiting_seen_at is 'When this run last asked for a slice and was told to wait (0087).';

create index if not exists runs_waiting_idx on runs (waiting_since)
  where waiting_since is not null and status in ('queued', 'running');
create index if not exists runs_leased_agent_idx on runs (agent_id, lease_until)
  where status in ('queued', 'running');

-- The claim, with two rules 0067's did not have:
--   * At most `per_agent` slices test one agent at once, whoever funds the runs: three runs
--     against one customer's endpoint are its traffic times three.
--   * Novera's shared grading slots (trial and plan-managed runs) go to the line in order of how
--     many slices the run's workspace holds now, then how long it has waited: one workspace's ten
--     runs take turns with another's one, and a run that has waited goes before one that has not.
--     A run between two of its own slices joins the back of that line, so runs take turns.
-- Answers {outcome: claimed, lease_token} or {outcome: busy, reason: slots|agent, position} or
-- {outcome: held} or {outcome: gone}, like 0067's with the reason and the place added.
create or replace function claim_run_slice_fair(target uuid, ws uuid, lease_ms integer, shared_slots integer, per_agent integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r runs;
  token uuid := gen_random_uuid();
  shared_sources text[] := array['trial_free', 'plan_managed'];
  agent_busy integer;
  active integer;
  place integer;
begin
  select * into r from runs where id = target and workspace_id = ws;
  if not found or r.status not in ('queued', 'running') then
    return jsonb_build_object('outcome', 'gone');
  end if;
  if r.lease_until is not null and r.lease_until > now() then
    return jsonb_build_object('outcome', 'held');
  end if;

  -- One lock for every decision about who runs next, as 0041 took for the shared slots alone.
  perform pg_advisory_xact_lock(hashtext('novera:trial-grading'));

  select count(*) into agent_busy from runs
   where agent_id = r.agent_id and id <> target
     and status in ('queued', 'running') and lease_until > now();
  if agent_busy >= greatest(per_agent, 1) then
    update runs set waiting_since = coalesce(waiting_since, now()), waiting_seen_at = now()
     where id = target;
    select count(*) + 1 into place from runs
     where agent_id = r.agent_id and id <> target and status in ('queued', 'running')
       and (lease_until is null or lease_until <= now())
       and waiting_seen_at > now() - interval '2 minutes'
       and waiting_since < coalesce(r.waiting_since, now());
    return jsonb_build_object('outcome', 'busy', 'reason', 'agent', 'position', place);
  end if;

  if r.judge_source = any (shared_sources) then
    select count(*) into active from runs
     where judge_source = any (shared_sources) and id <> target
       and status in ('queued', 'running') and lease_until > now();

    with line as (
      select w.id,
             case when w.id = target then coalesce(w.waiting_since, now()) else w.waiting_since end as since,
             (select count(*) from runs h
               where h.workspace_id = w.workspace_id and h.judge_source = any (shared_sources)
                 and h.status in ('queued', 'running') and h.lease_until > now()) as holding
        from runs w
       where w.judge_source = any (shared_sources)
         and w.status in ('queued', 'running')
         and (w.lease_until is null or w.lease_until <= now())
         and (w.id = target or (w.waiting_since is not null and w.waiting_seen_at > now() - interval '2 minutes'))
    )
    select pos into place from (
      select id, row_number() over (order by holding, since, id) as pos from line
    ) ranked where ranked.id = target;

    if place > shared_slots - active then
      update runs set waiting_since = coalesce(waiting_since, now()), waiting_seen_at = now()
       where id = target;
      return jsonb_build_object('outcome', 'busy', 'reason', 'slots', 'position', place - greatest(shared_slots - active, 0));
    end if;
  end if;

  update runs
     set status = 'running',
         lease_until = now() + make_interval(secs => lease_ms / 1000.0),
         lease_token = token,
         waiting_since = null,
         waiting_seen_at = null
   where id = target and workspace_id = ws
     and status in ('queued', 'running')
     and (lease_until is null or lease_until < now());
  if not found then
    return jsonb_build_object('outcome', 'held');
  end if;
  return jsonb_build_object('outcome', 'claimed', 'lease_token', token);
end;
$$;

revoke execute on function claim_run_slice_fair(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function claim_run_slice_fair(uuid, uuid, integer, integer, integer) to service_role;

-- The run the next free shared slot should go to, for the dispatcher that starts it when a slice
-- hands back: the head of the same line, among runs that waited in the last ten minutes. Ids only.
create or replace function next_waiting_run()
returns table (run_id uuid, workspace_id uuid)
language sql
security definer
set search_path = public
as $$
  select w.id, w.workspace_id
    from runs w
   where w.waiting_since is not null
     and w.status in ('queued', 'running')
     and (w.lease_until is null or w.lease_until <= now())
     and w.waiting_seen_at > now() - interval '10 minutes'
   order by (select count(*) from runs h
              where h.workspace_id = w.workspace_id and h.status in ('queued', 'running') and h.lease_until > now()),
            w.waiting_since, w.id
   limit 1;
$$;

revoke execute on function next_waiting_run() from public, anon, authenticated;
grant execute on function next_waiting_run() to service_role;
