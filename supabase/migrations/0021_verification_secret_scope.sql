-- A credential for the read-back endpoint is a customer secret like any other: sealed
-- at rest, server-side only, never in a config blob and never in a report.
--
-- Its own scope rather than reusing agent_auth, because the two authorise different
-- systems and should be revocable separately — a customer who rotates the key their
-- agent uses has not necessarily rotated the one that reads their order database.
alter table secrets drop constraint if exists secrets_scope_check;
alter table secrets add constraint secrets_scope_check
  check (scope in ('agent_auth', 'judge_key', 'verification_auth'));
