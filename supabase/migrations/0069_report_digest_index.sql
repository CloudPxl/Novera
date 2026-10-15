-- Public seal lookups find a report by its SHA-256 (2026-10-15).
--
-- /verify/<digest>, /api/verify/<digest> and /api/badge/<digest> each read `reports` by
-- `content_hash` and nothing else. Until now that was a sequential scan of every sealed
-- report, run by anyone on the internet who pastes a digest or loads a badge; this index
-- makes each lookup an index scan.
--
-- Not unique. A digest covers the sealed content, which names its run, so two reports
-- sharing one does not happen in practice — but uniqueness is a promise about rows already
-- sealed, and this migration only makes reading them cheaper. The lookups already take the
-- oldest row when more than one matches.
--
-- An index changes no row and no rule, so it needs no erasure path: it goes with the rows.

create index if not exists reports_content_hash_idx on public.reports (content_hash);
