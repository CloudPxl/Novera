-- The third API scope: `write`, for the MCP tools that ask a model for something a
-- person then decides — scenario drafts from a policy, and a diagnosis of a failure.
--
-- What it does not grant is the point of it. A draft cannot run and a proposal changes
-- nothing: approving either is a person's act, recorded with their name (0007, 0022),
-- and no scope reaches it. A confirmation token handed back to the calling model would
-- not change that — the model can pass it straight back — so the boundary is the
-- decision itself, not a second call.
--
-- Like `run`, it spends something real (model calls on our grading quota), so a key has
-- it only if its creator chose it, and a key with it always also reads.
--
-- A draft or a proposal a key asked for names the key, and who was responsible for it —
-- the key's creator, the same rule a run started by a key follows (0035). A person's
-- request now records its person too: until this migration a diagnosis did not say who
-- asked for it.

alter table api_keys drop constraint if exists api_keys_scopes_check;
alter table api_keys add constraint api_keys_scopes_check check (
  cardinality(scopes) > 0
  and scopes <@ array['read', 'run', 'write']
  and (not ('run' = any(scopes)) or 'read' = any(scopes))
  and (not ('write' = any(scopes)) or 'read' = any(scopes))
);

alter table scenario_drafts add column if not exists api_key_id uuid references api_keys (id) on delete restrict;
comment on column scenario_drafts.api_key_id is
  'The API key that asked for this draft, when an assistant did through MCP. Null when a person did.';

alter table diagnoses add column if not exists requested_by uuid references auth.users (id);
alter table diagnoses add column if not exists api_key_id uuid references api_keys (id) on delete restrict;
comment on column diagnoses.requested_by is
  'Who asked for this diagnosis — the person, or the creator of the key that asked. Null before 0039.';
comment on column diagnoses.api_key_id is
  'The API key that asked for this diagnosis, when an assistant did through MCP. Null when a person did.';

-- Who asked is set once. Read through jsonb, as refuse_mutation does: one function
-- guards two tables whose columns differ.
create or replace function freeze_request_attribution()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) ->> 'api_key_id') is distinct from (to_jsonb(old) ->> 'api_key_id')
  or (to_jsonb(new) ->> 'created_by') is distinct from (to_jsonb(old) ->> 'created_by')
  or (to_jsonb(new) ->> 'requested_by') is distinct from (to_jsonb(old) ->> 'requested_by') then
    raise exception 'Who asked for a % is recorded once and cannot be changed', tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists scenario_drafts_freeze_attribution on scenario_drafts;
create trigger scenario_drafts_freeze_attribution before update on scenario_drafts
  for each row execute function freeze_request_attribution();

drop trigger if exists diagnoses_freeze_attribution on diagnoses;
create trigger diagnoses_freeze_attribution before update on diagnoses
  for each row execute function freeze_request_attribution();

-- The key must belong to the row's workspace, like every other reference (0034).
drop trigger if exists scenario_drafts_same_workspace on scenario_drafts;
create trigger scenario_drafts_same_workspace before insert or update on scenario_drafts for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'policy_id', 'policies',
    'production_failure_id', 'production_failures', 'included_in_suite_id', 'suites',
    'api_key_id', 'api_keys');

drop trigger if exists diagnoses_same_workspace on diagnoses;
create trigger diagnoses_same_workspace before insert or update on diagnoses for each row
  execute function refuse_cross_workspace('run_case_id', 'run_cases', 'resulting_policy_id', 'policies',
    'api_key_id', 'api_keys');

-- erase_workspace() already removes scenario_drafts and diagnoses before api_keys
-- (0036), so the new references need no change to it.
