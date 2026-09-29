-- Grading capacity on the shared trial keys, and stopping a run.
--
-- Measured 2026-09-29 (`npm run measure:throughput`, 12 scenarios per run, trial
-- keys): one run at a time, every verdict corroborated across vendors; four at once,
-- Groq's free tier (8,000 tokens a minute, shared by every trial workspace) ran out,
-- 29 of 48 verdicts fell back to Mistral alone — corroborated within one vendor, a
-- weaker claim — and 6 had no result, because Mistral's two models disagreed and
-- nothing independent was left to settle it.
--
-- The limit is global, so a per-workspace cap would not help: four customers with one
-- run each hit it the same. So at most N slices grade on the trial keys at once. A run
-- that finds them taken is not refused — its slice is simply not started, which every
-- caller (run page, API, CLI, n8n, the clock) already treats as "call again". A run on
-- the workspace's own key grades on that key's quota and is not held here.
--
-- The count and the claim happen under one lock, so two callers at the same moment
-- cannot both see a free slot.

create or replace function claim_run_slice(target uuid, ws uuid, lease_ms integer, trial_slots integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r runs;
begin
  select * into r from runs where id = target and workspace_id = ws;
  if not found or r.status not in ('queued', 'running') then
    return 'gone';
  end if;

  if r.judge_source = 'trial_free' then
    perform pg_advisory_xact_lock(hashtext('novera:trial-grading'));
    if (select count(*) from runs
         where judge_source = 'trial_free' and id <> target
           and status in ('queued', 'running') and lease_until > now()) >= trial_slots then
      return 'busy';
    end if;
  end if;

  update runs
     set status = 'running', lease_until = now() + make_interval(secs => lease_ms / 1000.0)
   where id = target and workspace_id = ws
     and status in ('queued', 'running')
     and (lease_until is null or lease_until < now());
  if not found then
    return 'held';
  end if;
  return 'claimed';
end;
$$;

revoke execute on function claim_run_slice(uuid, uuid, integer, integer) from public, anon, authenticated;

-- A person can stop a run they no longer want: nothing else ends one early, and a run
-- waiting for grading capacity should not have to wait out the 24-hour rule (0040).
-- Its graded scenarios stay; no report is sealed over them.
alter table runs add column if not exists stopped_by uuid references auth.users (id);
comment on column runs.stopped_by is
  'Who stopped this run before it finished. Null when it finished, failed, or was stopped for making no progress.';
