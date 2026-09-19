-- A built-in suite has workspace_id = null, and in Postgres NULL is not equal to
-- NULL, so `unique (workspace_id, key, version)` never fires for built-ins: the same
-- suite could be seeded twice and a run could reference either copy. Two partial
-- indexes say what was actually meant.

create unique index suites_builtin_key_version
  on suites (key, version)
  where workspace_id is null;

create unique index suites_workspace_key_version
  on suites (workspace_id, key, version)
  where workspace_id is not null;
