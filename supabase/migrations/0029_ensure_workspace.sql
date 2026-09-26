-- One workspace per user, created exactly once.
--
-- requireWorkspace() read "is there a workspace?" and then inserted one. Two page loads
-- arriving together both read "no" and both inserted — one real account ended up with
-- two workspaces, the second empty. The check and the insert now happen inside one
-- function, under a transaction-scoped advisory lock keyed on the user, so a second
-- caller waits for the first and then finds its workspace.
--
-- A unique index on owner_id would also have stopped it, but it would forbid a person
-- from ever owning a second workspace, which the schema deliberately allows.
create or replace function ensure_workspace(p_name text)
returns table (id uuid, name text, plan text)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ensure_workspace:' || uid::text, 0));

  return query
    select w.id, w.name, w.plan from workspaces w
    join workspace_members m on m.workspace_id = w.id and m.user_id = uid
    order by w.created_at asc
    limit 1;
  if found then
    return;
  end if;

  -- The workspaces_add_owner trigger adds the membership row.
  return query
    insert into workspaces (name, owner_id)
    values (left(coalesce(nullif(trim(p_name), ''), 'My workspace'), 120), uid)
    returning workspaces.id, workspaces.name, workspaces.plan;
end;
$$;

revoke all on function ensure_workspace(text) from public, anon;
grant execute on function ensure_workspace(text) to authenticated;
