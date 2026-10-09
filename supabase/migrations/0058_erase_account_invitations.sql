-- Deleting an account left its email address on invitations (app-wide audit, 2026-10-08).
--
-- `erase_account` (0054) removed memberships, memory, conversations and the profile, and the
-- application pseudonymises the sign-in. But `workspace_invitations.email` still held the
-- address, and the owner's Members page displayed it: on the invitation the person accepted,
-- and on any invitation to them they never opened. The docs promise evidence stays attributed
-- to an identifier that no longer carries a name or an email.
--
-- An invitation's terms are frozen (0054), so the one change allowed here is narrow: during an
-- account erasure, the address becomes that account's pseudonym, and an invitation still open
-- is revoked by the person it was for.

create or replace function workspace_invitations_forward_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'An invitation is revoked, not deleted.';
  end if;
  -- Account erasure: only the address changes, to the pseudonym, and an open invitation closes.
  if coalesce(current_setting('novera.erasing_account', true), 'off') = 'on'
     and new.email like 'deleted-%@deleted.invalid'
     and new.id = old.id and new.workspace_id = old.workspace_id and new.role = old.role
     and new.token_hash = old.token_hash and new.invited_by = old.invited_by
     and new.created_at = old.created_at and new.expires_at = old.expires_at
     and new.accepted_at is not distinct from old.accepted_at
     and new.accepted_by is not distinct from old.accepted_by
     and (old.revoked_at is not null or old.accepted_at is not null
          or new.revoked_at is not null) then
    return new;
  end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.email <> old.email or new.role <> old.role
     or new.token_hash <> old.token_hash or new.invited_by <> old.invited_by or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at then
    raise exception 'An invitation''s terms are frozen.';
  end if;
  if old.accepted_at is not null or old.revoked_at is not null then
    raise exception 'An invitation that was accepted or revoked stays that way.';
  end if;
  return new;
end;
$$;

create or replace function erase_account(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owned integer;
  n_ws integer;
  n_inv integer;
  address text;
  pseudonym text := 'deleted-' || target || '@deleted.invalid';
begin
  select count(*) into owned from workspaces where owner_id = target;
  if owned > 0 then raise exception 'owns_workspaces'; end if;
  select lower(btrim(email)) into address from auth.users where id = target;
  perform set_config('novera.erasing_account', 'on', true);
  select count(*) into n_ws from workspace_members where user_id = target;
  update api_keys set revoked_at = now(), revoked_by = target where created_by = target and revoked_at is null;
  delete from workspace_members where user_id = target;
  delete from assistant_memory_candidates where user_id = target;
  delete from assistant_memory where user_id = target;
  delete from assistant_threads where user_id = target;
  delete from audit_events where workspace_id is null and actor_id = target;
  delete from user_profiles where user_id = target;
  -- Every invitation that names this person: the one they accepted, and any to their address.
  update workspace_invitations
     set email = pseudonym,
         revoked_at = case when accepted_at is null and revoked_at is null then now() else revoked_at end,
         revoked_by = case when accepted_at is null and revoked_at is null then target else revoked_by end
   where accepted_by = target or (address is not null and email = address);
  get diagnostics n_inv = row_count;
  perform set_config('novera.erasing_account', 'off', true);
  return jsonb_build_object('memberships_left', n_ws, 'invitations_pseudonymised', n_inv);
end;
$$;
revoke all on function erase_account(uuid) from public, anon, authenticated;
