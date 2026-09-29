-- Raw evidence has a retention clock.
--
-- A run keeps what the agent actually said — its reply, the whole conversation, the
-- tool activity — because that is what a person reads to check a verdict. It was kept
-- for as long as the workspace existed, only because the column did. That text is the
-- most likely place for personal data to sit in this database: an agent that leaks
-- does it there.
--
-- Now each workspace chooses how long raw evidence is kept (30, 90, 180 or 365 days;
-- 180 by default, the minimum the AI Act sets for a deployer's logs). After that the
-- raw fields are emptied and the row records when. Everything else stays for as long
-- as the workspace does: the verdict, the rationale, the votes, the checks, the report —
-- and a SHA-256 of the raw evidence taken when it was stored, so a copy kept elsewhere
-- can still be shown to be the one that was graded.
--
-- Evidence is append-only (0001), so this is a second narrow exception beside erasure:
-- only `expire_raw_evidence()` may do it, only to rows past the workspace's period, and
-- the update may change the raw fields and the expiry stamp and nothing else.

alter table workspaces add column if not exists raw_evidence_days smallint not null default 180
  check (raw_evidence_days in (30, 90, 180, 365));
comment on column workspaces.raw_evidence_days is
  'Days an agent''s raw replies, transcripts and tool activity are kept after a case is graded. '
  'Verdicts, rationales, hashes and reports are kept until the workspace is erased.';

-- The fingerprint. jsonb's text form is canonical in Postgres, so the same evidence
-- always hashes the same; the unit separator keeps the fields from running together.
create or replace function raw_evidence_sha256(response_text text, transcript jsonb, tool_activity jsonb)
returns text language sql immutable as $$
  select encode(sha256(convert_to(concat_ws(E'\x1f',
    coalesce(response_text, ''), coalesce(transcript::text, ''), coalesce(tool_activity::text, '')), 'UTF8')), 'hex')
$$;

alter table run_cases add column if not exists raw_sha256 text;
alter table run_cases add column if not exists raw_expired_at timestamptz;
alter table case_retests add column if not exists raw_sha256 text;
alter table case_retests add column if not exists raw_expired_at timestamptz;

create or replace function stamp_raw_evidence() returns trigger language plpgsql as $$
begin
  new.raw_sha256 := raw_evidence_sha256(
    new.response_text,
    new.transcript,
    (to_jsonb(new) -> 'tool_activity')
  );
  new.raw_expired_at := null;
  return new;
end;
$$;

drop trigger if exists run_cases_stamp_raw on run_cases;
create trigger run_cases_stamp_raw before insert on run_cases
  for each row execute function stamp_raw_evidence();
drop trigger if exists case_retests_stamp_raw on case_retests;
create trigger case_retests_stamp_raw before insert on case_retests
  for each row execute function stamp_raw_evidence();

-- Rows stored before today get their fingerprint now, from the evidence they still hold.
alter table run_cases disable trigger run_cases_immutable;
update run_cases set raw_sha256 = raw_evidence_sha256(response_text, transcript, tool_activity)
  where raw_sha256 is null;
alter table run_cases enable trigger run_cases_immutable;
alter table case_retests disable trigger case_retests_immutable;
update case_retests set raw_sha256 = raw_evidence_sha256(response_text, transcript, null)
  where raw_sha256 is null;
alter table case_retests enable trigger case_retests_immutable;

create or replace function expiring_raw_evidence() returns boolean language sql stable as $$
  select coalesce(current_setting('novera.expiring_raw', true), '') = 'on'
$$;

-- The append-only rule, with the second exception. Same function for every evidence
-- table; the new branch applies only to the two that hold raw evidence.
create or replace function refuse_mutation()
returns trigger language plpgsql as $$
declare
  raw_fields text[] := array['response_text', 'transcript', 'tool_activity', 'raw_expired_at'];
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

  raise exception 'Table % is append-only: % is not permitted', tg_table_name, tg_op;
end;
$$;

-- Empties raw evidence past each workspace's period. Idempotent; run daily.
create or replace function expire_raw_evidence()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_cases integer;
  n_retests integer;
begin
  perform set_config('novera.expiring_raw', 'on', true);

  update run_cases rc
     set response_text = null, transcript = null, tool_activity = null, raw_expired_at = now()
    from workspaces w
   where rc.workspace_id = w.id
     and rc.raw_expired_at is null
     and rc.created_at < now() - make_interval(days => w.raw_evidence_days);
  get diagnostics n_cases = row_count;

  update case_retests cr
     set response_text = null, transcript = null, raw_expired_at = now()
    from workspaces w
   where cr.workspace_id = w.id
     and cr.raw_expired_at is null
     and cr.created_at < now() - make_interval(days => w.raw_evidence_days);
  get diagnostics n_retests = row_count;

  perform set_config('novera.expiring_raw', 'off', true);
  return jsonb_build_object('cases', n_cases, 'retests', n_retests);
end;
$$;

revoke execute on function expire_raw_evidence() from public, anon, authenticated;

comment on column run_cases.raw_sha256 is
  'SHA-256 of the raw evidence (response_text, transcript, tool_activity) as stored; kept after expiry.';
comment on column run_cases.raw_expired_at is
  'When the raw evidence was emptied under the workspace''s retention period. Null while it is kept.';

-- The clock: daily, in the quiet hours. The job's text holds nothing secret.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('novera-raw-evidence-expiry', '17 3 * * *', 'select public.expire_raw_evidence()');
  end if;
end;
$$;
