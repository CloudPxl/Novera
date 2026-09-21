-- Which assertions actually failed is evidence, and it was being thrown away.
--
-- `judgeCase()` returns `failedAssertions`, `gradeCase()` carries it through, and
-- `executeRun()` dropped it on the floor because there was nowhere to put it. So a
-- report could say a case failed, but never which of its stated requirements went
-- unmet — the most useful thing a reader wants to know, computed and discarded on
-- every run since the first.
--
-- Same shape as 0006 (grading provenance). Worth noticing that this is the third time
-- the runner has produced evidence the schema had no column for.

alter table run_cases
  add column failed_assertions jsonb not null default '[]'::jsonb;

comment on column run_cases.failed_assertions is
  'The assertions the judge found unmet, verbatim from the suite case. Empty for a pass.';
