-- Withdrawing a report is permanent, and names who did it.
--
-- 0001 let a report's `revoked_at` and `expires_at` change and nothing else, which kept the
-- evidence and its hash fixed. It also let a withdrawn report be quietly un-withdrawn —
-- `revoked_at` back to null — and recorded no one as having withdrawn it. The operator
-- interface now has a "Withdraw this report" control, so both matter: a client told a
-- link was withdrawn must be able to rely on it staying withdrawn, and a workspace must be
-- able to see who withdrew it.
--
-- `revoked_by` is set with `revoked_at`, once. A withdrawn report's expiry no longer moves.
-- The column goes with the report on erasure (cascade, 0005); a deleted user is kept as null.

alter table reports add column if not exists revoked_by uuid references auth.users (id) on delete set null;

create or replace function reports_revoke_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Reports are append-only; revoke instead of deleting';
  end if;
  if new.payload is distinct from old.payload
     or new.content_hash is distinct from old.content_hash
     or new.run_id is distinct from old.run_id
     or new.token is distinct from old.token
     or new.created_at is distinct from old.created_at
     or new.workspace_id is distinct from old.workspace_id then
    raise exception 'Only revoked_at, revoked_by and expires_at may be changed on a report';
  end if;
  if old.revoked_at is not null and (
       new.revoked_at is distinct from old.revoked_at
       or new.revoked_by is distinct from old.revoked_by
       or new.expires_at is distinct from old.expires_at) then
    raise exception 'A withdrawn report stays withdrawn';
  end if;
  if new.revoked_by is distinct from old.revoked_by and new.revoked_at is null then
    raise exception 'revoked_by is set only when the report is withdrawn';
  end if;
  return new;
end;
$$;
