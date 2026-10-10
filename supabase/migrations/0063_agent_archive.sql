-- An agent can be archived, and restored, but never deleted (launch item G1).
--
-- Runs, reports, probes and evidence name the agent, so removing it would orphan what a
-- client was already handed. Archiving takes it out of the lists and stops anything new
-- from reaching it; everything it already produced stays where it is and stays readable.
-- Erasure is still erase_workspace() and nothing else.
--
-- What the database holds, whoever writes (the service role included):
--   * no new run of an archived agent, and no schedule of one created or resumed;
--   * an agent is not archived while a run of it is queued or running, and its connection
--     (agents.config) does not change while one is — the run declared that connection in
--     its manifest (0016) and reads it again on every slice;
--   * an archive names who archived it and when, and cannot be redated or reattributed;
--     restoring clears both;
--   * an agent is never deleted outside erase_workspace().
-- Archive and run start take the same per-agent lock, so of the two at once exactly one
-- wins and the other is refused with a sentence.
--
-- `archived_by` is a plain id, as on audit_events: an erased account is pseudonymised, so
-- the id stays meaningful and carries no personal data.
--
-- Clients still write no agents row (0057): the new columns sit under the same revoke,
-- restated here so a later grant on the table cannot reopen them by accident.

alter table agents add column if not exists archived_at timestamptz;
alter table agents add column if not exists archived_by uuid;

alter table agents drop constraint if exists agents_archive_named;
alter table agents add constraint agents_archive_named
  check ((archived_at is null) = (archived_by is null));

revoke insert, update, delete on agents from anon, authenticated;

comment on column agents.archived_at is
  'Set when an owner or admin archived the agent; null when active. Archived agents take no new run or schedule.';
comment on column agents.archived_by is
  'Who archived the agent. Set with archived_at, cleared with it on restore.';

-- ------------------------------------------------------------------ one lock per agent
create or replace function lock_agent_for_runs(agent uuid)
returns void language sql as $$
  select pg_advisory_xact_lock(hashtext('novera:agent-runs'), hashtext(agent::text));
$$;
revoke execute on function lock_agent_for_runs(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ agents
create or replace function agents_archive_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'agent_not_deletable: an agent cannot be deleted, because its runs and reports name it; archive it instead';
  end if;

  if old.archived_at is not null and new.archived_at is not null
     and (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by) then
    raise exception 'agent_archive_frozen: an archive cannot be redated or reattributed';
  end if;

  if old.archived_at is not null and new.archived_at is not null and new.config is distinct from old.config then
    raise exception 'agent_archived: an archived agent''s connection cannot change; restore it first';
  end if;

  if (old.archived_at is null and new.archived_at is not null) or new.config is distinct from old.config then
    -- Taken before the check, so the check sees a run another transaction just committed.
    perform lock_agent_for_runs(new.id);
    if exists (select 1 from runs where agent_id = new.id and status in ('queued', 'running')) then
      if old.archived_at is null and new.archived_at is not null then
        raise exception 'agent_busy: an agent cannot be archived while a run of it is queued or running';
      end if;
      raise exception 'agent_busy: an agent''s connection cannot change while a run of it is queued or running';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists agents_archive_guard on agents;
create trigger agents_archive_guard before update or delete on agents
  for each row execute function agents_archive_guard();

-- ------------------------------------------------------------------ runs
create or replace function runs_agent_not_archived()
returns trigger language plpgsql as $$
begin
  perform lock_agent_for_runs(new.agent_id);
  if exists (select 1 from agents where id = new.agent_id and archived_at is not null) then
    raise exception 'agent_archived: agent % is archived; restore it to start a run', new.agent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists runs_agent_not_archived on runs;
create trigger runs_agent_not_archived before insert on runs
  for each row execute function runs_agent_not_archived();

-- ------------------------------------------------------------------ schedules
-- Only a schedule becoming active is refused: one created, or one resumed. Pausing and
-- cancelling stay possible, and the tick's own bookkeeping on a schedule is untouched.
create or replace function run_schedules_agent_not_archived()
returns trigger language plpgsql as $$
begin
  if new.paused_at is null and new.cancelled_at is null
     and (tg_op = 'INSERT' or old.paused_at is not null) then
    if exists (select 1 from agents where id = new.agent_id and archived_at is not null) then
      raise exception 'agent_archived: agent % is archived; restore it before scheduling or resuming its runs', new.agent_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists run_schedules_agent_not_archived on run_schedules;
create trigger run_schedules_agent_not_archived before insert or update on run_schedules
  for each row execute function run_schedules_agent_not_archived();
