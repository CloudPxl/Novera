-- The bar a run was measured against, recorded with the run.
--
-- A grade band is meaningless without the threshold that produced it, and a threshold
-- that lives only in a settings screen can be changed after the fact, which would make
-- every past grade quietly wrong. It is therefore stamped on the run at creation and
-- copied into the report.
--
-- It deliberately does NOT affect any case verdict. A customer-settable bar that moved
-- pass/fail would make every score self-serving; this only decides which band the
-- already-computed percentage falls into.

alter table runs
  add column pass_threshold integer not null default 80
    check (pass_threshold between 0 and 100);

comment on column runs.pass_threshold is
  'Percentage at or above which this run is graded a pass. Affects the displayed grade '
  'band only, never an individual case verdict.';
