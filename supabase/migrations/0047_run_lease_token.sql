-- A run's lease names its holder.
--
-- A slice holds `runs.lease_until` while it grades; past that, another call may take the
-- run over. But nothing said *which* slice held it, so a slice that outlived its lease —
-- a hung database call, a raised maxDuration, a self-hosted server — went on sending
-- scenarios to the customer's agent, saved over the slice that took over (the second
-- save of a scenario aborted the whole run on the unique key), released the newcomer's
-- lease and could abort the run it no longer held (audit 2026-09-30, C4: three
-- scenarios sent twice, the run aborted, its report lost).
--
-- Now each claim writes a fresh token, and every write a slice makes — saving a scenario,
-- finishing, releasing, aborting — names it. A slice whose token no longer stands stops
-- before its next scenario and writes nothing. This bounds, and cannot remove, one
-- duplicate: a scenario already sent when the lease was taken over may be sent again by
-- the slice that took over. Nothing tells Novera whether the agent acted on the first.
--
-- claim_run_slice (0041) stays as it was for any caller still deployed with it.

alter table runs add column if not exists lease_token uuid;

create or replace function claim_run_slice_fenced(target uuid, ws uuid, lease_ms integer, trial_slots integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r runs;
  token uuid := gen_random_uuid();
begin
  select * into r from runs where id = target and workspace_id = ws;
  if not found or r.status not in ('queued', 'running') then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if r.judge_source = 'trial_free' then
    perform pg_advisory_xact_lock(hashtext('novera:trial-grading'));
    if (select count(*) from runs
         where judge_source = 'trial_free' and id <> target
           and status in ('queued', 'running') and lease_until > now()) >= trial_slots then
      return jsonb_build_object('outcome', 'busy');
    end if;
  end if;

  update runs
     set status = 'running',
         lease_until = now() + make_interval(secs => lease_ms / 1000.0),
         lease_token = token
   where id = target and workspace_id = ws
     and status in ('queued', 'running')
     and (lease_until is null or lease_until < now());
  if not found then
    return jsonb_build_object('outcome', 'held');
  end if;
  return jsonb_build_object('outcome', 'claimed', 'lease_token', token);
end;
$$;

revoke execute on function claim_run_slice_fenced(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function claim_run_slice_fenced(uuid, uuid, integer, integer) to service_role;
