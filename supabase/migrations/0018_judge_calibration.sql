-- Every measurement of a judge model against ground truth, kept so drift is visible.
--
-- This exists because of what happened on 2026-09-22 and again on 2026-09-23. Nothing
-- in the codebase changed, and yet gemini-3.5-flash-lite started missing a planted
-- failure, and nemotron false-passed a case it had previously graded correctly. Models
-- move under a fixed name. A calibration that is only ever printed to a terminal
-- catches that once, by luck; a stored series catches it on the next run.
--
-- Deliberately NOT workspace-scoped and NOT customer data: these are our measurements
-- of our own grading models, over the scripted fixture. No personal data reaches this
-- table, so — unlike every other table here — it needs no path in erase_workspace().
-- RLS is on with no policies at all, so it is reachable only with the service role.
create table if not exists judge_calibrations (
  id             uuid primary key default gen_random_uuid(),
  measured_at    timestamptz not null default now(),
  suite_key      text not null,
  suite_version  integer not null,
  -- The grading instructions the measurement was taken under. A number measured
  -- against a different rubric is not comparable, and the rubric changes without
  -- anyone bumping a version.
  rubric_hash    text not null,
  connection     text not null,
  model          text not null,
  labelled       integer not null,
  agreed         integer not null,
  false_passes   integer not null,
  false_fails    integer not null,
  errors         integer not null,
  ms_per_case    integer not null,
  -- Which cases, not just how many: a model that moves from missing T11 to missing
  -- T21 has changed even when the totals match.
  false_pass_ids text[] not null default '{}',
  false_fail_ids text[] not null default '{}',
  error_ids      text[] not null default '{}'
);

create index if not exists judge_calibrations_model_idx
  on judge_calibrations (connection, model, measured_at desc);

alter table judge_calibrations enable row level security;

comment on table judge_calibrations is
  'Measurements of judge models against labelled fixture responses. Ours, not a customer''s: no personal data, no workspace scope, service role only.';
