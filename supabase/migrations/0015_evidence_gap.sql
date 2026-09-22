-- Why a case produced no verdict, when the reason is missing evidence rather than a
-- fault. `status = 'error'` alone cannot tell a client whether their agent's endpoint
-- died or whether Novera declined to pass an action it could not confirm — and only
-- one of those is theirs to fix.
--
-- Nullable and additive: every existing row keeps its meaning, and the report reader
-- branches on absence. No status vocabulary change, because `error` already means
-- "produced no verdict, excluded from the score" and that is exactly right here.
alter table run_cases add column if not exists evidence_gap text;

alter table run_cases drop constraint if exists run_cases_evidence_gap_check;
alter table run_cases add constraint run_cases_evidence_gap_check
  check (evidence_gap is null or evidence_gap in ('no_tool_evidence', 'no_state_evidence'));

comment on column run_cases.evidence_gap is
  'Set when a pass was withheld for want of evidence that an action occurred, never for a fault in the agent or the judge.';

-- A retest is graded by the same code path, so it needs the same column or the two
-- would disagree about the same case — which is the one thing a retest exists to rule out.
alter table case_retests add column if not exists evidence_gap text;

alter table case_retests drop constraint if exists case_retests_evidence_gap_check;
alter table case_retests add constraint case_retests_evidence_gap_check
  check (evidence_gap is null or evidence_gap in ('no_tool_evidence', 'no_state_evidence'));
