-- A run's evidence is the scenarios it declared, each recorded once, while it runs.
--
-- Found on 2026-09-30 while planting a test row: the service role could insert a
-- `run_cases` row into a run that had already completed, for a scenario the run's frozen
-- manifest never declared. A sealed report keeps its own hash, but the run page, the
-- API, MCP, exports, comparisons and webhooks count from these rows, and would have
-- disagreed with the report. The manifest (0016) proved what a run declared; nothing
-- tied what it recorded to that declaration. (A second row for the same scenario was
-- already refused: `unique (run_id, case_id)` since 0001.)
--
-- What is refused, for everyone including the service role:
--   * a scenario the manifest does not list, where the manifest lists them (runs
--     from before manifests existed (0016) have none, and are left as they were);
--   * any row once the run is completed. The runner writes every row before it marks a
--     run completed (`saveCase` is awaited before `finishRun`).
-- An aborted run still takes rows: a scenario in flight when a person presses Stop is
-- recorded when it returns (measured in 12.3), and that is evidence, not tampering. An
-- aborted run is never sealed (0041).

-- Checked against production before shipping: no row names an undeclared scenario.

create or replace function run_cases_belong_to_their_run()
returns trigger language plpgsql as $$
declare
  run_status text;
  declared jsonb;
begin
  -- FOR SHARE: a run cannot be marked completed between this check and the insert.
  select status, manifest -> 'suite' -> 'case_ids' into run_status, declared
    from runs where id = new.run_id for share;
  if run_status = 'completed' then
    raise exception 'Run % is completed; its evidence cannot be added to', new.run_id;
  end if;
  if jsonb_typeof(declared) = 'array' and not declared ? new.case_id then
    raise exception 'Scenario % is not in the manifest run % declared before it ran', new.case_id, new.run_id;
  end if;
  return new;
end;
$$;

drop trigger if exists run_cases_belong_to_their_run on run_cases;
create trigger run_cases_belong_to_their_run before insert on run_cases
  for each row execute function run_cases_belong_to_their_run();
