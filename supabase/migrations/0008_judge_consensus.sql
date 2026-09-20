-- Corroboration is part of the evidence.
--
-- A verdict is now the finding of two models rather than one, after a single judge
-- was measured drifting on 25% of scenarios when re-grading identical agent
-- responses (scripts/measure-judge-stability.mts). A report that says "failed" should
-- be able to say who decided that and whether anyone agreed, and a reader who wants
-- to know how firm a verdict is should not have to take our word for it.
--
-- `judge_agreement` is deliberately nullable: a case where the agent returned nothing
-- was never graded at all, so there is no agreement to record.

alter table run_cases
  add column judge_votes jsonb not null default '[]'::jsonb,
  add column judge_agreement text
    check (judge_agreement is null or judge_agreement in ('agreed', 'majority', 'unconfirmed', 'unresolved'));

comment on column run_cases.judge_votes is
  'what each model consulted on this case said, including any that was overruled';
comment on column run_cases.judge_agreement is
  'agreed = both models matched; majority = a third settled a disagreement; '
  'unconfirmed = only one model was reachable; unresolved = the tie could not be broken';
