-- Starting a run is safe to retry, and the trial's three runs are three.
--
-- Two defects of the same shape, both reproduced (audit 2026-09-30 G1; 2026-10-01 C7):
--
-- 1. POST /api/v1/runs had no idempotency. A pipeline that timed out and retried started,
--    and spent, a second run.
-- 2. The trial cap was counted in the application and then inserted: twenty starts at
--    once on a fresh trial workspace created 7, 14, 17 and 20 runs against a limit of 3.
--
-- The cap now lives where the rows are. Inserting a run graded on Novera's shared trial
-- keys takes a per-workspace lock, counts the workspace's runs — every run, as
-- workspaceEntitlement counts them — and refuses a fourth. The number is the
-- application's TRIAL_RUN_LIMIT (src/lib/auth/entitlement.ts); change both together.
--
-- An Idempotency-Key is claimed in run_requests before the run exists, with the id the
-- run will have, so a retry always finds either that run or proof that it never started.
-- A key is honoured for 24 hours; older claims are removed when the workspace next sends
-- one, and with the workspace.

create or replace function runs_trial_cap()
returns trigger language plpgsql as $$
declare
  used integer;
begin
  if new.judge_source = 'trial_free' then
    perform pg_advisory_xact_lock(hashtext('novera:trial-cap'), hashtext(new.workspace_id::text));
    select count(*) into used from runs where workspace_id = new.workspace_id;
    if used >= 3 then
      raise exception 'trial_exhausted: the trial covers 3 runs and workspace % has used them', new.workspace_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists runs_trial_cap on runs;
create trigger runs_trial_cap before insert on runs
  for each row execute function runs_trial_cap();

create table if not exists run_requests (
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  -- SHA-256 of what was asked: the agent, the suite, and what the caller declared.
  request_hash    text not null,
  -- The id the run is created with; claimed before the run row exists, so no foreign key.
  run_id          uuid not null,
  created_at      timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);
comment on table run_requests is
  'Idempotency-Key claims for POST /api/v1/runs. Server-only: RLS on, no policy; 24-hour validity.';

alter table run_requests enable row level security;
revoke all on table run_requests from public, anon, authenticated;
