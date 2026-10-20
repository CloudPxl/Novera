-- One scenario id per production-failure draft, and one suite per Suite Builder build
-- (Round 2 audit, 2026-10-19).
--
-- A production failure becomes a draft named R01, R02… — the next number after the ids the
-- workspace's drafts already use, read and then inserted with nothing in between. Twelve failures
-- sent at once came back as R09 eight times and R10 three times; once approved, the duplicates
-- could not be promoted ("Case id R09 is already used") and an approved draft cannot be rejected,
-- so the workspace's regression drafts were stuck. The database now refuses a second draft with
-- the same id, and the recorder (src/lib/regressions/record.ts) takes the next free one.
--
-- Publishing one build from three tabs at once created two suite versions from it, one tab showing
-- Postgres's own words. A build now yields at most one suite; the loser is told the build was just
-- published (src/lib/builder/service.ts).
--
-- Both indexes hold rows created from the moment this migration runs: a database that already
-- holds such duplicates still migrates, and nothing already sealed changes. The cut-off is written
-- into each index as a constant, because an index predicate cannot call now().
--
-- An index changes no row and refuses nothing that was valid, so it needs no erasure path: it goes
-- with the rows.

do $$
declare
  cutoff text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if to_regclass('public.scenario_drafts_production_id_unique') is null then
    execute format(
      'create unique index scenario_drafts_production_id_unique on public.scenario_drafts (workspace_id, (scenario ->> %L)) where origin = %L and created_at >= %L::timestamptz',
      'id', 'production', cutoff);
  end if;
  if to_regclass('public.suites_one_per_build') is null then
    execute format(
      'create unique index suites_one_per_build on public.suites ((provenance ->> %L)) where (provenance ->> %L) is not null and created_at >= %L::timestamptz',
      'build_id', 'build_id', cutoff);
  end if;
end $$;

-- Assistant memory (0054) refused key-shaped values in the database but links and instructions
-- only in the application, while the guarantee said "also in the database". The plain forms are
-- now refused here too; disguised forms (look-alike letters, invisible characters) are read by
-- `checkMemoryValue` (src/lib/assistant/memory.ts), which every write goes through. NOT VALID:
-- enforced on every new or changed row, without failing a database that holds an older one.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assistant_memory_not_link_or_instruction') then
    alter table public.assistant_memory add constraint assistant_memory_not_link_or_instruction check (
      value !~* '(https?://|www\.|javascript:|\]\()'
      and value !~* '\m(ignore|disregard|override|bypass)\M.{0,40}\m(instructions?|prompt|rules?|policy|previous|above|system)\M'
      and value !~* '(system prompt|you are now|from now on)'
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assistant_memory_candidates_not_link_or_instruction') then
    alter table public.assistant_memory_candidates add constraint assistant_memory_candidates_not_link_or_instruction check (
      value !~* '(https?://|www\.|javascript:|\]\()'
      and value !~* '\m(ignore|disregard|override|bypass)\M.{0,40}\m(instructions?|prompt|rules?|policy|previous|above|system)\M'
      and value !~* '(system prompt|you are now|from now on)'
    ) not valid;
  end if;
end $$;
