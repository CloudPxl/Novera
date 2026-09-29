-- Ninety days for what strangers send us and for connection receipts (decided by the
-- user, 2026-09-29).
--
-- Support messages and trial applications are the personal data of people who are not
-- customers and have no workspace — the reason 0010 gave them an erasure path of their
-- own. They are now also erased on a clock: 90 days after the last thing that happened
-- in the conversation (the request, a draft, an approval, a send), so a thread that is
-- still being answered is never cut off mid-way. Each erasure is logged as retention,
-- distinct from one a person asked for.
--
-- A probe receipt is one harmless request and whatever the agent sent back. After 90
-- days its body, headers and discovered shape are emptied; when it happened, the status
-- code, the latency and any error stay, so "this agent answered on that day" survives.
-- Probes are append-only (0001), so this is the retention exception of 0037 extended to
-- one more table, under the same rule: only in expiry mode, only those fields, nothing
-- else in the same update.

alter table inbound_erasure_log add column if not exists reason text not null default 'request'
  check (reason in ('request', 'retention'));

drop function if exists erase_inbound_request(uuid, uuid);
create or replace function erase_inbound_request(target uuid, requested_by uuid default null, reason text default 'request')
returns inbound_erasure_log
language plpgsql
security definer
set search_path = public
as $$
declare
  record inbound_erasure_log;
  n_drafts integer;
begin
  select count(*) into n_drafts from reply_drafts where request_id = target;

  perform set_config('novera.erasing', 'on', true);
  delete from reply_drafts where request_id = target;
  delete from inbound_requests where id = target;
  perform set_config('novera.erasing', 'off', true);

  insert into inbound_erasure_log (request_id, requested_by, drafts_removed, reason)
  values (target, requested_by, n_drafts, reason)
  returning * into record;

  return record;
end;
$$;

revoke execute on function erase_inbound_request(uuid, uuid, text) from public, anon, authenticated;

alter table probes add column if not exists content_expired_at timestamptz;
comment on column probes.content_expired_at is
  'When the response body, headers and shape were emptied, 90 days after the probe.';

create or replace function refuse_mutation()
returns trigger language plpgsql as $$
declare
  raw_fields text[] := array['response_text', 'transcript', 'tool_activity', 'raw_expired_at'];
  probe_fields text[] := array['response_body', 'response_headers', 'response_shape', 'content_expired_at'];
begin
  if tg_op = 'DELETE' and erasing_workspace() then
    return old;
  end if;

  if tg_op = 'UPDATE' and expiring_raw_evidence() and tg_table_name in ('run_cases', 'case_retests')
     -- Read through jsonb, never old.<column>: this function guards tables without
     -- these columns, and SQL does not promise to stop evaluating at the first false.
     and (to_jsonb(old) ->> 'raw_expired_at') is null
     and (to_jsonb(new) ->> 'raw_expired_at') is not null
     and (to_jsonb(new) ->> 'response_text') is null
     and (to_jsonb(new) ->> 'transcript') is null
     and (to_jsonb(new) ->> 'tool_activity') is null
     and (to_jsonb(new) - raw_fields) = (to_jsonb(old) - raw_fields) then
    return new;
  end if;

  if tg_op = 'UPDATE' and expiring_raw_evidence() and tg_table_name = 'probes'
     and (to_jsonb(old) ->> 'content_expired_at') is null
     and (to_jsonb(new) ->> 'content_expired_at') is not null
     and (to_jsonb(new) ->> 'response_body') is null
     and (to_jsonb(new) ->> 'response_headers') is null
     and (to_jsonb(new) ->> 'response_shape') is null
     and (to_jsonb(new) - probe_fields) = (to_jsonb(old) - probe_fields) then
    return new;
  end if;

  raise exception 'Table % is append-only: % is not permitted', tg_table_name, tg_op;
end;
$$;

-- The daily pass for both. Ninety days is the decision, so it is written here once.
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
  perform set_config('novera.expiring_raw', 'off', true);

  return jsonb_build_object('requests', n_requests, 'probes', n_probes);
end;
$$;

revoke execute on function expire_inbound_and_probes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('novera-inbound-probe-expiry', '27 3 * * *', 'select public.expire_inbound_and_probes()');
  end if;
end;
$$;
