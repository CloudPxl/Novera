-- The rules a verdict has to obey, enforced by the database rather than by the code
-- that happens to write it.
--
-- Every one of these is already true of all 162 stored rows and is already enforced in
-- `src/lib/evidence/*` and `src/lib/runner/execute.ts`. That is exactly why they are
-- worth writing down here: the product's claim is that its evidence cannot be bent,
-- and "the application is careful" is a weaker guarantee than "the row is refused".
-- A future script, a migration, or a service-role fix-up bypasses the code and not
-- the constraint.
--
-- Each one is NOT VALID-free on purpose: they are validated against existing rows
-- immediately, so a violation would fail this migration rather than lurk.

-- A case that produced no result is not a pass. This is the single most important
-- invariant in the product and it has never been enforced below the application.
alter table run_cases drop constraint if exists run_cases_error_is_not_pass;
alter table run_cases add constraint run_cases_error_is_not_pass
  check (status <> 'pass' or error is null);

-- An evidence gap means "no verdict for want of proof", so it belongs only on a case
-- that produced no verdict. A gap on a pass would be the exact laundering the effect
-- rule exists to prevent.
alter table run_cases drop constraint if exists run_cases_gap_only_without_verdict;
alter table run_cases add constraint run_cases_gap_only_without_verdict
  check (evidence_gap is null or status = 'error');

-- A case settled by a rule was never put to a model, so it cannot name one as its
-- grader. Attributing a deterministic verdict to a judge would misdescribe how the
-- most defensible verdicts in a run were reached.
alter table run_cases drop constraint if exists run_cases_rule_settled_has_no_judge;
alter table run_cases add constraint run_cases_rule_settled_has_no_judge
  check (settled_by is distinct from 'deterministic' or (judge_model is null and judge_agreement is null));

-- The same three rules for a retest, which is graded by the same code path and must
-- not be able to say something a run could not.
alter table case_retests drop constraint if exists case_retests_error_is_not_pass;
alter table case_retests add constraint case_retests_error_is_not_pass
  check (status <> 'pass' or error is null);

alter table case_retests drop constraint if exists case_retests_gap_only_without_verdict;
alter table case_retests add constraint case_retests_gap_only_without_verdict
  check (evidence_gap is null or status = 'error');
