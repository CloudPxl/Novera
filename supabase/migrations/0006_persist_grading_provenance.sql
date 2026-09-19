-- Which model produced a verdict is part of the evidence, not a runtime detail.
--
-- `run_cases` had nowhere to record it, so the information existed only in memory
-- while a run was executing. The report happened to show it because it was built
-- from the in-memory summary — rebuild that report from stored rows a month later
-- and the provenance would be gone, along with any way to tell that a fallback
-- changed graders partway through.

alter table run_cases
  add column judge_model text,
  add column judge_attempts jsonb not null default '[]'::jsonb;

comment on column run_cases.judge_model is
  'connection/model that actually produced this verdict, after any fallback';
comment on column run_cases.judge_attempts is
  'every judge candidate tried for this case, failures included';
