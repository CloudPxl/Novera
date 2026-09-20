-- Erasing someone who wrote to us.
--
-- The same defect as 0005, in a worse place. `reply_drafts` refuses DELETE so that a
-- sent reply cannot be quietly unsent — but `inbound_requests` cascades into it, so
-- any request that had a draft became permanently undeletable. That row holds the
-- email address, organisation and message of a person who is not a customer, has no
-- workspace, and is therefore out of reach of erase_workspace entirely.
--
-- They have an unconditional right to erasure. A support queue we cannot empty on
-- request is not a defensible thing to operate, least of all here.
--
-- Same resolution as 0005: no piecemeal deletion of a draft, complete erasure of a
-- request permitted, through one authorised path that records that it happened.

create table inbound_erasure_log (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null,
  requested_by   uuid,
  erased_at      timestamptz not null default now(),
  drafts_removed integer not null default 0
);
alter table inbound_erasure_log enable row level security;
-- No policy: readable only by the server. A record of erasure is not queue data, and
-- it deliberately keeps nothing that identifies the person who asked.

create or replace function erase_inbound_request(target uuid, requested_by uuid default null)
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

  insert into inbound_erasure_log (request_id, requested_by, drafts_removed)
  values (target, requested_by, n_drafts)
  returning * into record;

  return record;
end;
$$;

revoke execute on function erase_inbound_request(uuid, uuid) from anon, authenticated;

comment on function erase_inbound_request(uuid, uuid) is
  'The only path that removes an inbound request and its drafts. Staff-only, through '
  'the server, and logged.';
