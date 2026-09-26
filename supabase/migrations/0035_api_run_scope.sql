-- The second API scope: `run`, for starting a run from a pipeline.
--
-- It spends something real — a trial run, or grading on the customer's own model key —
-- so it is never implied. A key has it only if the person who created it chose it, and
-- a key with it always also reads (it has to, to follow the run it started). The list
-- stays closed: a scope nothing uses cannot be granted.
--
-- A run started by a key names the key, so "who started this" has an answer that is not
-- the key's creator pretending to have clicked a button.

alter table api_keys drop constraint if exists api_keys_scopes_check;
alter table api_keys add constraint api_keys_scopes_check check (
  cardinality(scopes) > 0
  and scopes <@ array['read', 'run']
  and (not ('run' = any(scopes)) or 'read' = any(scopes))
);

alter table runs add column if not exists api_key_id uuid references api_keys (id) on delete restrict;
comment on column runs.api_key_id is
  'The API key that started this run, when a pipeline started it. Null when a person did.';

-- The key must belong to the run's workspace, like every other reference (0034).
drop trigger if exists runs_same_workspace on runs;
create trigger runs_same_workspace before insert or update on runs for each row
  execute function refuse_cross_workspace(
    'agent_id', 'agents', 'policy_id', 'policies', 'suite_id', 'suites', 'baseline_run_id', 'runs',
    'api_key_id', 'api_keys');
