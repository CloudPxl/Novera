-- A completed run holds a result for every scenario it declared.
--
-- 0043 stopped a completed run taking new rows, and stopped rows for scenarios the manifest
-- never declared. Nothing stopped the reverse: a run marked completed while a declared
-- scenario had no row. The runner never does that — it finishes a run only after every
-- scenario was recorded — but the service role could, and a pipeline reading such a run
-- saw "pass" from its rows while the sealed report said INCOMPLETE (audit 2026-09-30, R2,
-- reproduced by planting). Now the database refuses it, for every writer.
--
-- Only the transition into `completed` is checked; runs completed before this migration
-- are not re-examined. An aborted run may end with scenarios missing: it is never sealed.
-- The update's row lock waits for any scenario still being inserted (0043 reads the run
-- FOR SHARE), so the check sees every committed row.

create or replace function completed_run_holds_its_scenarios()
returns trigger language plpgsql as $$
declare
  missing text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and jsonb_typeof(new.manifest -> 'suite' -> 'case_ids') = 'array' then
    select string_agg(declared.id, ', ' order by declared.ord) into missing
      from jsonb_array_elements_text(new.manifest -> 'suite' -> 'case_ids') with ordinality as declared(id, ord)
     where not exists (select 1 from run_cases c where c.run_id = new.id and c.case_id = declared.id);
    if missing is not null then
      raise exception 'Run % cannot be completed: declared scenario(s) % have no recorded result', new.id, missing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists completed_run_holds_its_scenarios on runs;
create trigger completed_run_holds_its_scenarios before update on runs
  for each row execute function completed_run_holds_its_scenarios();
