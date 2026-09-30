-- A production failure can arrive from a pipeline: `POST /api/v1/production-failures`,
-- with a key that has the `write` scope. The incident → regression loop an agency runs
-- from its ticketing, without anyone retyping the incident into Novera.
--
-- The failure names the key that sent it, like a run (0035), a draft or a diagnosis
-- (0039): "who put this here" is part of the record. `production_failures` is already
-- append-only for everyone (0031), so the name cannot be rewritten; the key must belong to
-- the same workspace, like every other reference (0034). Erasure already deletes failures
-- before keys (0042's erase_workspace), so the restrict below never blocks it.

alter table production_failures
  add column if not exists api_key_id uuid references api_keys (id) on delete restrict;
comment on column production_failures.api_key_id is
  'The API key that sent this failure, when a pipeline did; null when a person used the form.';

drop trigger if exists production_failures_same_workspace on production_failures;
create trigger production_failures_same_workspace before insert or update on production_failures for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'api_key_id', 'api_keys');

-- An automation retries. The same incident sent twice is recognised by the hash of its
-- original text (0031 keeps nothing else of it) and answered with the first record —
-- unique, so two identical requests racing each other cannot both create one. There
-- were no failures stored when this shipped.
create unique index if not exists production_failures_once
  on production_failures (workspace_id, (redaction ->> 'original_hash'));
