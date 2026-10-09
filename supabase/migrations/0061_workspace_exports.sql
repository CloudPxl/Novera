-- Workspace data export (launch-readiness O6).
--
-- An owner or admin can take a copy of everything in their workspace as one versioned JSON file
-- ("novera.workspace-export.v1", built by src/lib/export/workspace.ts). This table is the
-- receipt, not the file: Novera never stores the export. A request makes a `pending` row with a
-- short expiry; the one download builds the file, and the row then records the SHA-256 of the
-- exact bytes handed over, their size and the row counts, and becomes `ready`. A second
-- download of the same row is refused, and so is any download after `expires_at`.
--
-- Statuses move forward once: pending → ready | expired | failed. Who asked, when, the format
-- and whether raw evidence was asked for are frozen at the request, for everyone including the
-- service role. A row can be removed only by erase_workspace().
--
-- Read by the workspace's owner and admins (RLS); no client may write. Every write goes
-- through the server, behind `workspace.export` in src/lib/auth/permissions.ts.

create table if not exists workspace_exports (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references workspaces (id) on delete cascade,
  -- A plain id, as on audit_events: an account that is deleted is pseudonymised, and the id
  -- carries no personal data.
  requested_by          uuid not null,
  status                text not null default 'pending' check (status in ('pending', 'ready', 'expired', 'failed')),
  format                text not null default 'novera.workspace-export.v1' check (format ~ '^novera\.workspace-export\.v[0-9]+$'),
  -- The agent's own replies and transcripts, only when the requester asked for them.
  includes_raw_evidence boolean not null default false,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null default now() + interval '15 minutes',
  delivered_at          timestamptz,
  sha256                text check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size             bigint check (byte_size >= 0),
  row_counts            jsonb check (row_counts is null or (jsonb_typeof(row_counts) = 'object' and octet_length(row_counts::text) <= 4000)),
  error                 text check (error is null or char_length(error) <= 500),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  -- `ready` means the file was handed over, and says exactly what it was.
  check ((status = 'ready') = (sha256 is not null and byte_size is not null and row_counts is not null and delivered_at is not null)),
  check (status <> 'failed' or error is not null),
  check (status = 'failed' or error is null)
);
create index if not exists workspace_exports_ws on workspace_exports (workspace_id, created_at desc);

alter table workspace_exports enable row level security;
drop policy if exists workspace_exports_select on workspace_exports;
create policy workspace_exports_select on workspace_exports for select
  using (has_workspace_role(workspace_id, array['owner', 'admin']));
-- No write policy, and no write grant either, so a policy added later by mistake reopens nothing.
revoke insert, update, delete, truncate on workspace_exports from anon, authenticated;

create or replace function workspace_exports_forward_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'An export receipt is kept until the workspace is erased.';
  end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.requested_by <> old.requested_by
     or new.format <> old.format or new.includes_raw_evidence <> old.includes_raw_evidence
     or new.created_at <> old.created_at or new.expires_at <> old.expires_at then
    raise exception 'An export''s request is frozen: who asked, when, its format and its expiry.';
  end if;
  if old.status <> 'pending' then
    raise exception 'An export that is % stays %.', old.status, old.status;
  end if;
  if new.status = 'pending' then
    raise exception 'An export leaves pending only to ready, expired or failed.';
  end if;
  if new.status = 'ready' and now() > old.expires_at then
    raise exception 'This export expired before it was downloaded.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_exports_forward_only on workspace_exports;
create trigger workspace_exports_forward_only before update or delete on workspace_exports
  for each row execute function workspace_exports_forward_only();

comment on table workspace_exports is
  'Receipts of workspace data exports: who asked, when, whether raw evidence was included, and '
  'for a delivered one the SHA-256, size and row counts of the exact file. The file itself is '
  'never stored. pending -> ready | expired | failed, once.';

-- ------------------------------------------------------------------ erasure
--
-- Every table that refuses deletion needs an erasure path in the same migration.
-- 0056's body exactly, plus workspace_exports beside the other 0054-era tables.
-- MERGE NOTE: if a migration numbered between 0056 and 0061 also redefines erase_workspace,
-- its additions must be folded into this body, or 0061 silently drops them.

create or replace function erase_workspace(target uuid, requested_by uuid default null)
returns erasure_log
language plpgsql
security definer
set search_path = public
as $$
declare
  record erasure_log;
  n_agents integer;
  n_runs integer;
  n_cases integer;
  n_reports integer;
begin
  select count(*) into n_agents from agents where workspace_id = target;
  select count(*) into n_runs from runs where workspace_id = target;
  select count(*) into n_cases from run_cases where workspace_id = target;
  select count(*) into n_reports from reports where workspace_id = target;

  perform set_config('novera.erasing', 'on', true);

  -- 0054's tables first: they reference runs' neighbours only through the workspace.
  delete from assistant_memory_candidates where workspace_id = target;
  delete from assistant_memory      where workspace_id = target;
  delete from assistant_threads     where workspace_id = target;
  delete from workspace_invitations where workspace_id = target;
  -- 0061: export receipts. They name the workspace only; the files were never stored.
  delete from workspace_exports     where workspace_id = target;
  delete from audit_events          where workspace_id = target;
  -- A profile pointing here loses the default, not the profile.
  update user_profiles set default_workspace_id = null where default_workspace_id = target;
  update user_profiles set default_agent_id = null
   where default_agent_id in (select id from agents where workspace_id = target);


  -- Before the endpoints they belong to.
  delete from webhook_deliveries    where workspace_id = target;
  delete from webhook_endpoints     where workspace_id = target;
  delete from reports               where workspace_id = target;
  delete from diagnoses             where workspace_id = target;
  delete from case_retests          where workspace_id = target;
  delete from evidence_observations where workspace_id = target;
  -- Before run_cases, which it references.
  delete from verdict_reviews       where workspace_id = target;
  delete from run_cases             where workspace_id = target;
  delete from runs                  where workspace_id = target;
  -- After the runs that name them, before the agents and suites they name.
  delete from run_schedules         where workspace_id = target;
  delete from probes                where workspace_id = target;
  delete from scenario_drafts       where workspace_id = target;
  -- 0056: after the drafts that name them, before the agents and suites they name.
  delete from suite_obligations     where workspace_id = target;
  delete from suite_sources         where workspace_id = target;
  delete from suite_builds          where workspace_id = target;
  -- After the drafts that reference it, before the agents it references.
  delete from production_failures   where workspace_id = target;
  delete from api_keys              where workspace_id = target;
  delete from policies              where workspace_id = target;
  delete from secrets               where workspace_id = target;
  delete from agents                where workspace_id = target;
  delete from suites                where workspace_id = target;
  delete from workspace_members     where workspace_id = target;
  delete from workspaces            where id = target;

  perform set_config('novera.erasing', 'off', true);

  insert into erasure_log (workspace_id, requested_by, agents_removed, runs_removed, cases_removed, reports_removed)
  values (target, requested_by, n_agents, n_runs, n_cases, n_reports)
  returning * into record;

  return record;
end;
$$;
