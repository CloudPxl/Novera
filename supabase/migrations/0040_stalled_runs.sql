-- A run's evidence comes from one sitting.
--
-- A run is advanced by whoever started it — the run page, a pipeline, the clock. If
-- that stops (the tab is closed, the pipeline dies), the run sits at queued or running,
-- and until now it would resume whenever someone came back: a report dated today could
-- then carry replies from an agent as it was last week, with nothing to say so.
--
-- So a run that has graded nothing for 24 hours is stopped, as `aborted` with the
-- reason. It is never completed, so no report is sealed over what it has; its graded
-- cases stay as they are, append-only, and a new run is the way forward. The daily
-- pass is in the database, not behind the application's clock, because the clock only
-- calls the application when a scheduled run is due or in flight.

create or replace function abort_stalled_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update runs r
     set status = 'aborted',
         error = 'Stopped: no scenario was graded for 24 hours, so this run cannot finish as one sitting. '
              || 'Its graded scenarios are kept; start a new run for a report.',
         finished_at = now(),
         lease_until = null
   where r.status in ('queued', 'running')
     and greatest(
           r.created_at,
           coalesce(r.started_at, r.created_at),
           coalesce((select max(c.created_at) from run_cases c where c.run_id = r.id), r.created_at)
         ) < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function abort_stalled_runs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('novera-stalled-runs', '37 3 * * *', 'select public.abort_stalled_runs()');
  end if;
end;
$$;
