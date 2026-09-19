-- `insert ... returning` applies the SELECT policy to the row being returned, and it
-- does so before the AFTER trigger that adds the owner to workspace_members has run.
-- So an owner creating a workspace with .select() was refused: at that instant
-- is_workspace_member(id) was still false.
--
-- Making ownership sufficient on its own is also the more honest rule — a workspace's
-- owner can read it because they own it, not because a row in another table says so.

drop policy ws_select on workspaces;

create policy ws_select on workspaces for select
  using (owner_id = auth.uid() or is_workspace_member(id));
