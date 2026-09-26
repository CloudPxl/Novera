-- A scenario can be a conversation: earlier customer turns, then the final message.
--
-- `response_text` stays what it has always been — the agent's last reply — so every
-- existing reader keeps working. The whole exchange is kept beside it, because a
-- verdict on a conversation is a verdict on all of it: a refund granted in the second
-- turn is not undone by a refusal in the fourth, and a reader has to be able to see
-- the turn that decided it. Null on every single-message case, which is every row
-- stored before this existed.
--
-- run_cases and case_retests are already append-only (0001, 0013) and already erased
-- with their workspace; a new column needs no new path.

alter table run_cases    add column if not exists transcript jsonb;
alter table case_retests add column if not exists transcript jsonb;

alter table run_cases drop constraint if exists run_cases_transcript_shape;
alter table run_cases add constraint run_cases_transcript_shape
  check (transcript is null or (jsonb_typeof(transcript) = 'array' and jsonb_array_length(transcript) >= 2));

alter table case_retests drop constraint if exists case_retests_transcript_shape;
alter table case_retests add constraint case_retests_transcript_shape
  check (transcript is null or (jsonb_typeof(transcript) = 'array' and jsonb_array_length(transcript) >= 2));

comment on column run_cases.transcript is
  'For a conversation scenario: every turn, customer and agent, in order. Null for a '
  'single-message scenario. response_text is always the final agent reply.';
