-- pg_cron keeps a row per job run in cron.job_run_details and never removes one. The schedule
-- clock runs every minute, so production gained about 10,000 rows a week (16,401 by 2026-10-10)
-- and the job check in `verify:cron` started timing out. The history only needs to show that each
-- job ran recently: thirty days of it is kept, removed by a daily job like the others.

create or replace function prune_cron_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function prune_cron_history() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('novera-cron-history', '47 3 * * *', 'select public.prune_cron_history()');
  end if;
end;
$$;
