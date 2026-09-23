-- What a run declared about itself before it ran.
--
-- The report hash proves a document was not edited after the fact. It says nothing
-- about whether the inputs were fixed beforehand — "you picked the suite once you had
-- seen the answers" is a question a sealed report alone cannot answer. The manifest is
-- written at insert, before the first case executes, and frozen here.
alter table runs add column if not exists manifest jsonb;
alter table runs add column if not exists manifest_hash text;

-- Set once, never changed. A run row is otherwise updated several times as it
-- progresses (queued -> running -> completed), so this cannot rely on the
-- append-only trigger the evidence tables use.
create or replace function freeze_run_manifest() returns trigger
language plpgsql
as $$
begin
  if old.manifest is not null and new.manifest is distinct from old.manifest then
    raise exception 'A run manifest is declared before the run and cannot be changed.';
  end if;
  if old.manifest_hash is not null and new.manifest_hash is distinct from old.manifest_hash then
    raise exception 'A run manifest hash is declared before the run and cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists runs_freeze_manifest on runs;
create trigger runs_freeze_manifest
  before update on runs
  for each row execute function freeze_run_manifest();

comment on column runs.manifest is
  'Inputs declared before execution: suite version and case ids, policy version, agent, judge plan, rubric digest, runner version, pass mark. Frozen by trigger.';
