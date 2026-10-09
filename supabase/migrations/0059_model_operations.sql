-- Which models did a workspace's model work, and who paid for it.
--
-- Diagnosis, drafting from a policy and Suite Builder extraction always ran on Novera's own
-- provider keys, even for a workspace grading on its own key — so its policy and documents went
-- to providers it had not chosen, and nothing recorded which (app-wide audit, 2026-10-08). They
-- now go through the workspace's own key when it has one, with no fallback, and each operation
-- is recorded here: the operation, who funded it, which connection and model answered each call,
-- how many attempts it took, and whether a usable result came back. Never the key, never the
-- prompt, never the output.

create table if not exists model_operations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  operation     text not null check (operation in ('diagnose', 'draft', 'extract', 'assistant')),
  funded_by     text not null check (funded_by in ('trial_free', 'workspace_key')),
  outcome       text not null check (outcome in ('ok', 'no_usable_output', 'error', 'refused')),
  -- One entry per model call: {task, served_by, attempts, fell_back, failures:[reason…]}.
  calls         jsonb not null default '[]'::jsonb
                check (jsonb_typeof(calls) = 'array' and octet_length(calls::text) <= 8000),
  detail        text check (detail is null or char_length(detail) <= 500),
  requested_by  uuid,
  api_key_id    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists model_operations_ws on model_operations (workspace_id, created_at desc);

alter table model_operations enable row level security;
drop policy if exists model_operations_select on model_operations;
create policy model_operations_select on model_operations for select using (is_workspace_member(workspace_id));
-- Written by the server only (0057's rule: no client writes a record of what happened).
revoke insert, update, delete on model_operations from anon, authenticated;

comment on table model_operations is
  'One row per model operation (diagnose, draft, extract, assistant): funding source, models that answered, attempts, outcome. No keys, prompts or outputs. Erased with the workspace (cascade).';
