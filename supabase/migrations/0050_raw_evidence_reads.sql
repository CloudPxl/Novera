-- Who read a run's raw evidence through the API or MCP, and when.
--
-- `GET /api/v1/runs/<id>?include=responses` and MCP `get_run` with include_responses
-- return what each scenario sent and the agent's replies, unredacted: that is how a
-- customer investigates a verdict, and it is deliberate. It is also the one place an
-- API key reads customer conversations, so each such read is now recorded — which key,
-- which run, by which route — where the workspace's members can see it. A read key handed
-- to a client or a pipeline leaves a trail. (Privacy review of the 2026-09-30 audit's canary.)
--
-- Written only by the server; members read their workspace's rows; it goes with the
-- workspace on erasure (cascade), and with a run or key only through that erasure.

create table if not exists raw_evidence_reads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  run_id       uuid not null references runs (id) on delete cascade,
  api_key_id   uuid not null references api_keys (id) on delete cascade,
  via          text not null check (via in ('rest', 'mcp')),
  read_at      timestamptz not null default now()
);
create index if not exists raw_evidence_reads_by_run on raw_evidence_reads (workspace_id, run_id, read_at desc);

alter table raw_evidence_reads enable row level security;
drop policy if exists raw_evidence_reads_select on raw_evidence_reads;
create policy raw_evidence_reads_select on raw_evidence_reads for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table raw_evidence_reads from public, anon, authenticated;

drop trigger if exists raw_evidence_reads_same_workspace on raw_evidence_reads;
create trigger raw_evidence_reads_same_workspace before insert or update on raw_evidence_reads for each row
  execute function refuse_cross_workspace('run_id', 'runs');
drop trigger if exists raw_evidence_reads_same_workspace_key on raw_evidence_reads;
create trigger raw_evidence_reads_same_workspace_key before insert or update on raw_evidence_reads for each row
  execute function refuse_cross_workspace('api_key_id', 'api_keys');
