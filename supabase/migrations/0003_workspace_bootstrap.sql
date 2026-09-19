-- A workspace must always have its owner as a member.
--
-- Without this there is a chicken-and-egg: the owner may insert a workspace (the
-- ws_insert policy allows it) but then cannot select it, because is_workspace_member
-- is false, and cannot insert the membership row either, because workspace_members
-- has no insert policy. Making it a database invariant removes the race and means no
-- application code can forget it.

create or replace function add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

create trigger workspaces_add_owner
  after insert on workspaces
  for each row execute function add_owner_as_member();

-- Membership is append-only from a client's point of view: invitations will be
-- issued server-side after an authorisation check, never by a client writing a row.
-- Left without insert/update/delete policies deliberately.
