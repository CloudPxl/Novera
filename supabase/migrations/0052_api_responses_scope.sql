-- A fourth API scope: `responses`, for reading the agent's own words.
--
-- `GET /api/v1/runs/<id>?include=responses` and MCP `get_run` with include_responses
-- return what each scenario sent and what the agent replied, exactly as stored. Until now
-- any key that could read could ask for them, and 0050 only recorded that it had (audit
-- 2026-10-01, G6). A key handed to a CI pipeline needs verdicts and counts, never the
-- conversations; now it gets them only if its creator ticked that, and a key with it
-- always also reads.
--
-- No key is changed: scopes are frozen at creation (0033), and production held no API
-- key when this was written, so no existing key loses anything it was promised.

alter table api_keys drop constraint if exists api_keys_scopes_check;
alter table api_keys add constraint api_keys_scopes_check check (
  cardinality(scopes) > 0
  and scopes <@ array['read', 'run', 'write', 'responses']
  and (not ('run' = any(scopes)) or 'read' = any(scopes))
  and (not ('write' = any(scopes)) or 'read' = any(scopes))
  and (not ('responses' = any(scopes)) or 'read' = any(scopes))
);
