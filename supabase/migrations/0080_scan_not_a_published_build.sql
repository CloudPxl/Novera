-- An exploratory scan is not the suite a build publishes (final pre-launch audit F-1, 2026-10-28).
--
-- 0077 made a Suite Builder build yield at most one suite with a unique index on
-- provenance ->> 'build_id'. An exploratory scan (runExploratoryScan) also writes its build's id
-- into provenance, so once a build had been scanned it could never be published — the publisher
-- was told the build "was just published as scan-…" — and a second scan of the same build was
-- refused too. The run page tells people to scan and then publish, so this stranded every build
-- that followed the advice. `verify:builder` failed on it at 91178a1.
--
-- The index now counts only suites that are a build's publication: anything but an exploratory
-- scan. A scan is still never a report (0056 `reports_not_exploratory`), and scanning twice stays
-- allowed, as it was before 0077.
--
-- The index keeps 0077's cut-off, read from the index it replaces: resetting it to now would let a
-- build published between the two migrations be published again. Rows created under 0077's index
-- already satisfy the narrower rule. An index changes no row, so it needs no erasure path.

do $$
declare
  previous text;
  cutoff text;
begin
  select indexdef into previous from pg_indexes where schemaname = 'public' and indexname = 'suites_one_per_build';
  cutoff := substring(previous from 'created_at >= ''([^'']+)''');
  if cutoff is null then
    cutoff := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  drop index if exists public.suites_one_per_build;
  execute format(
    'create unique index suites_one_per_build on public.suites ((provenance ->> %L)) where (provenance ->> %L) is not null and approval <> %L and created_at >= %L::timestamptz',
    'build_id', 'build_id', 'exploratory', cutoff);
end $$;
