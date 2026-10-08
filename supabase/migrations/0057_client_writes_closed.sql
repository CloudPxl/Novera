-- Clients write no evidence-bearing row directly. Found by the app-wide audit, 2026-10-08.
--
-- 0054 gave owner, admin and operator an RLS policy to write `agents` straight through
-- PostgREST with the public key, and members a policy to insert `scenario_drafts` and
-- `production_failures`. The application never used them — every write goes through a
-- server action that checks the role and then writes with the service role — but the
-- policies covered every column. Reproduced on a local stack, signed in as an operator:
--   * `agents.is_production` set to false, which lets destructive and fixture-only scenarios
--     run against a production agent;
--   * `attested_by` / `attestation_text` rewritten, which every new run copies into its
--     sealed report as the authorisation to test;
--   * a production failure stored with a card number in clear and a fabricated redaction
--     hash, under a teammate's name;
--   * a draft approved "by" the owner, and an approval rewritten after the fact.
-- And anyone, signed in or not, could call `throttle_hit` and spend another person's or
-- another key's rate limit: 0024 revoked it from anon and authenticated but not from PUBLIC,
-- and 0027 revoked `throttle_peek` from nobody.

-- ------------------------------------------------------------------ client writes
drop policy if exists agents_insert on agents;
drop policy if exists agents_update on agents;
drop policy if exists scenario_drafts_insert on scenario_drafts;
drop policy if exists scenario_drafts_update on scenario_drafts;
drop policy if exists production_failures_insert on production_failures;

-- Without a policy RLS already refuses; the grants go too, so a policy added later by
-- mistake does not reopen the columns.
revoke insert, update, delete on agents from anon, authenticated;
revoke insert, update, delete on scenario_drafts from anon, authenticated;
revoke insert, update, delete on production_failures from anon, authenticated;

-- ------------------------------------------------------------------ attestation
-- Who attested that the agent may be tested, and what they attested, is stated once, at
-- connection, and carried into every run. Nobody rewrites it afterwards, the service role
-- included; a different attestation is a different agent.
create or replace function agents_attestation_frozen()
returns trigger language plpgsql as $$
begin
  if new.attested_by is distinct from old.attested_by
  or new.attested_at is distinct from old.attested_at
  or new.attestation_text is distinct from old.attestation_text
  or new.workspace_id is distinct from old.workspace_id then
    raise exception 'An agent''s attestation and workspace are fixed when it is connected';
  end if;
  return new;
end;
$$;

drop trigger if exists agents_attestation_frozen on agents;
create trigger agents_attestation_frozen before update on agents
  for each row execute function agents_attestation_frozen();

-- ------------------------------------------------------------------ draft decisions
-- A decision names its person once. Approved → approved was allowed by 0056 so that the
-- row could be touched again; it could also rename the approver.
create or replace function scenario_drafts_decision_frozen()
returns trigger language plpgsql as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Who drafted a scenario cannot be changed';
  end if;
  if old.approved_by is not null and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    raise exception 'An approval cannot be reattributed or redated';
  end if;
  if old.rejected_by is not null and (new.rejected_by is distinct from old.rejected_by or new.rejected_at is distinct from old.rejected_at
                                      or new.rejection_reason is distinct from old.rejection_reason) then
    raise exception 'A rejection cannot be reattributed, redated or reworded';
  end if;
  if old.not_applicable_by is not null and (new.not_applicable_by is distinct from old.not_applicable_by
                                            or new.not_applicable_at is distinct from old.not_applicable_at
                                            or new.not_applicable_reason is distinct from old.not_applicable_reason) then
    raise exception 'A not-applicable decision cannot be reattributed, redated or reworded';
  end if;
  return new;
end;
$$;

drop trigger if exists scenario_drafts_decision_frozen on scenario_drafts;
create trigger scenario_drafts_decision_frozen before update on scenario_drafts
  for each row execute function scenario_drafts_decision_frozen();

-- ------------------------------------------------------------------ throttle
-- The application calls both with the service role only (src/lib/support/rate-limit.ts).
revoke execute on function throttle_hit(text, integer) from public, anon, authenticated;
revoke execute on function throttle_peek(text, integer) from public, anon, authenticated;
grant execute on function throttle_hit(text, integer) to service_role;
grant execute on function throttle_peek(text, integer) to service_role;
