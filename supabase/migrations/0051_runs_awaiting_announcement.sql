-- Finished runs a webhook endpoint should have heard about and has not.
--
-- A run is announced by the slice that finishes it, right after it is marked finished. A
-- function killed between the two — the platform's time limit, a crash — leaves a finished
-- run that no delivery names, and nothing ever looked for one. Runs ended by the 24-hour
-- stalled-run pass (0040) were never announced at all: that pass runs in the database.
--
-- This lists them, each with the endpoint that missed it, for the clock to queue (src/lib/webhooks/deliver.ts announceMissedRuns)
-- and for the clock's own wake-up condition. Bounded: finished more than two minutes ago
-- (the finishing slice's own announcement has had its chance) and less than a day ago, and
-- only for endpoints that already existed when the run finished — adding an endpoint does
-- not replay a workspace's history to it.

create or replace function runs_awaiting_announcement(max_rows integer default 20)
returns table (workspace_id uuid, run_id uuid, endpoint_id uuid)
language sql
stable
set search_path = public
as $$
  select r.workspace_id, r.id, e.id
    from runs r
    join webhook_endpoints e
      on e.workspace_id = r.workspace_id
     and e.revoked_at is null
     and e.created_at <= r.finished_at
     and (case when r.status = 'completed' then 'run.completed' else 'run.stopped' end) = any (e.events)
   where r.status in ('completed', 'aborted')
     and r.finished_at > now() - interval '24 hours'
     and r.finished_at < now() - interval '2 minutes'
     and not exists (
       select 1 from webhook_deliveries d
        where d.endpoint_id = e.id and d.subject_id = r.id
          and d.event = case when r.status = 'completed' then 'run.completed' else 'run.stopped' end
     )
   limit greatest(max_rows, 0);
$$;
revoke execute on function runs_awaiting_announcement(integer) from public, anon, authenticated;
grant execute on function runs_awaiting_announcement(integer) to service_role;
