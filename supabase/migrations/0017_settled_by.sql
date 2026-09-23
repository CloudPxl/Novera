-- What settled this case: a deterministic check, or the models.
--
-- A case failed by a rule ("the reply contains the escalation code", "the agent
-- called delete_workspace") was never put to a judge, so it has no votes, no
-- agreement and no corroboration. Counting it as uncorroborated would be wrong —
-- nothing about it needed corroborating — and counting it as agreed would be worse.
--
-- Nullable and additive. Rows stored before this carry null, which means "settled by
-- the models", because that is all there was.
alter table run_cases add column if not exists settled_by text;
alter table run_cases drop constraint if exists run_cases_settled_by_check;
alter table run_cases add constraint run_cases_settled_by_check
  check (settled_by is null or settled_by in ('deterministic', 'models'));

alter table case_retests add column if not exists settled_by text;
alter table case_retests drop constraint if exists case_retests_settled_by_check;
alter table case_retests add constraint case_retests_settled_by_check
  check (settled_by is null or settled_by in ('deterministic', 'models'));

comment on column run_cases.settled_by is
  'deterministic = a rule in the scenario decided it and no model was called; models = graded by consensus. Null on rows stored before checks existed.';
