-- The trial's three runs belong to a person, not to a workspace.
--
-- 0049 counted runs per workspace, which was the same thing while a person could only ever have
-- one. Once anyone can open a workspace per client (0054), a per-workspace cap is three free
-- runs on Novera's keys per click of "New workspace". The count now spans every workspace the
-- new run's workspace owner owns, under a lock per owner, so concurrent starts across two of
-- their workspaces still cannot exceed three. For every existing owner (one workspace each) the
-- number is unchanged.

create or replace function runs_trial_cap()
returns trigger language plpgsql as $$
declare
  used integer;
  owner uuid;
begin
  if new.judge_source = 'trial_free' then
    select owner_id into owner from workspaces where id = new.workspace_id;
    perform pg_advisory_xact_lock(hashtext('novera:trial-cap'), hashtext(owner::text));
    select count(*) into used from runs r join workspaces w on w.id = r.workspace_id where w.owner_id = owner;
    if used >= 3 then
      raise exception 'trial_exhausted: the trial covers 3 runs per account and the owner of workspace % has used them', new.workspace_id;
    end if;
  end if;
  return new;
end;
$$;
