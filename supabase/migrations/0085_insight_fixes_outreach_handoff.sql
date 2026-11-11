-- Insight: fix suggestions, outreach drafts, staging handoffs, a workspace scan cap (2026-11-11).
--
-- What a graded public-demo scan leads to, each step a person's:
--   1. A fix suggestion for a failed observation: proposed by a model, decided by a person. It is a
--      hypothesis about one public reply — the confidence is "hypothesis" or "likely", never
--      "confirmed", a black-box scan cannot see a cause — it quotes the stored reply only verbatim
--      (checked in code before insert), states how to validate it and what could go wrong, and
--      carries a fixed sentence saying what it does not prove.
--   2. An outreach draft: written from a versioned template and the computed card's sentences,
--      never from free text a model wrote, never with the reply quoted. It carries a disclosure
--      line (who ran the test, not affiliated with the vendor) and an opt-out line. It goes
--      draft -> approved -> sent_recorded -> outcome_recorded, forward only. Novera never sends it:
--      a person sends it by hand and records that they did, with the channel and the date. No
--      recipient address is stored. A target marked do_not_contact refuses every new draft and
--      every approval or send record.
--   3. A handoff: the target linked to an agent in this workspace, for an evaluation the owner
--      authorised through the ordinary attested connection — the only way a Category B or C bot,
--      which is never scanned, is tested at all.
-- And one limit, now that /insight is open to workspaces holding insight.manage: at most 10 scans
-- queued per workspace in any 24 hours, counted here under a lock, beside the per-target rules of
-- 0082 (one active scan, 24 h cooldown, Category A only, re-checked at claim).
--
-- Erasure: every row hangs off workspaces (id) on delete cascade; erase_workspace() deletes the
-- workspace last under novera.erasing, so the cascaded deletes pass the triggers below, as 0082's do.
-- Retention: no raw reply is stored here — a suggestion's quotes are of the stored, already redacted
-- observation, at most five of 300 characters; a draft holds no reply text at all.

-- 1. Fix suggestions ----------------------------------------------------------------------------

create table if not exists insight_fix_suggestions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces (id) on delete cascade,
  scan_id           uuid not null references insight_scans (id) on delete cascade,
  observation_id    uuid not null references insight_observations (id) on delete cascade,
  scenario_id       text not null check (length(scenario_id) between 1 and 32),
  finding           text not null check (length(finding) between 1 and 1000),
  evidence_quotes   text[] not null default '{}' check (cardinality(evidence_quotes) <= 5),
  root_cause        text not null check (length(root_cause) between 1 and 1000),
  confidence        text not null check (confidence in ('hypothesis', 'likely')),
  proposed_change   text not null check (length(proposed_change) between 1 and 4000),
  where_to_apply    text not null check (where_to_apply in ('system_instructions', 'knowledge_base', 'escalation_rule', 'guardrail', 'widget_configuration')),
  validation_plan   text not null check (length(btrim(validation_plan)) between 1 and 2000),
  risks             text not null check (length(btrim(risks)) between 1 and 2000),
  does_not_prove    text not null check (does_not_prove = 'This is a hypothesis drawn from one public reply. It does not prove the cause, that the change fixes it, or how the bot answers anything else; only a scan after the change can show whether this reply moved.'),
  human_review      boolean not null default true check (human_review),
  model             text not null check (length(model) between 1 and 200),
  funding           text not null check (funding in ('trial_free', 'workspace_key', 'plan_managed')),
  status            text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  decided_by        uuid,
  decided_by_role   text check (decided_by_role is null or decided_by_role in ('owner', 'admin', 'operator')),
  decision_reason   text check (decision_reason is null or length(decision_reason) between 1 and 1000),
  decided_at        timestamptz,
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  check ((status = 'proposed') = (decided_by is null and decided_at is null and decided_by_role is null)),
  check (status <> 'rejected' or decision_reason is not null)
);
create index if not exists insight_fix_suggestions_observation on insight_fix_suggestions (observation_id);

create or replace function insight_fix_suggestion_rules()
returns trigger language plpgsql as $$
declare
  o insight_observations;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'A fix suggestion is never deleted; it is erased with its workspace' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select * into o from insight_observations where id = new.observation_id;
    if not found or o.scan_id <> new.scan_id or o.scenario_id <> new.scenario_id then
      raise exception 'A fix suggestion names its own scan''s observation' using errcode = '42501';
    end if;
    if o.status <> 'fail' then
      raise exception 'A fix is suggested only for an observation that failed' using errcode = '42501';
    end if;
    if new.status <> 'proposed' then
      raise exception 'A fix suggestion arrives proposed; a person decides it' using errcode = '42501';
    end if;
    return new;
  end if;
  -- UPDATE: only the decision, once.
  if old.status <> 'proposed' then
    raise exception 'A fix suggestion is decided once' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status', 'decided_by', 'decided_by_role', 'decision_reason', 'decided_at'])
     is distinct from (to_jsonb(old) - array['status', 'decided_by', 'decided_by_role', 'decision_reason', 'decided_at']) then
    raise exception 'A fix suggestion''s content is frozen; a new one is proposed instead' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists insight_fix_suggestion_rules on insight_fix_suggestions;
create trigger insight_fix_suggestion_rules before insert or update or delete on insight_fix_suggestions
  for each row execute function insight_fix_suggestion_rules();
drop trigger if exists insight_fix_suggestions_same_workspace on insight_fix_suggestions;
create trigger insight_fix_suggestions_same_workspace before insert or update on insight_fix_suggestions for each row
  execute function refuse_cross_workspace('observation_id', 'insight_observations');

alter table insight_fix_suggestions enable row level security;
drop policy if exists insight_fix_suggestions_select on insight_fix_suggestions;
create policy insight_fix_suggestions_select on insight_fix_suggestions for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table insight_fix_suggestions from public, anon, authenticated;

-- 2. Outreach drafts ----------------------------------------------------------------------------

create table if not exists insight_outreach_drafts (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces (id) on delete cascade,
  target_id          uuid not null references insight_targets (id) on delete cascade,
  -- The graded scan the draft speaks of; null only for a staging offer, which speaks of none.
  scan_id            uuid references insight_scans (id) on delete cascade,
  kind               text not null check (kind in ('email', 'dm', 'follow_up', 'staging_offer')),
  template_version   integer not null check (template_version >= 1),
  subject            text check (subject is null or length(subject) between 1 and 200),
  body               text not null check (length(body) between 1 and 6000),
  disclosure_line    text not null check (length(disclosure_line) between 20 and 600),
  opt_out_line       text not null check (length(opt_out_line) between 20 and 400),
  status             text not null default 'draft' check (status in ('draft', 'approved', 'sent_recorded', 'outcome_recorded')),
  approved_by        uuid,
  approved_at        timestamptz,
  sent_recorded_by   uuid,
  sent_recorded_at   timestamptz,
  sent_channel       text check (sent_channel is null or sent_channel in ('email', 'linkedin', 'contact_form', 'other')),
  outcome            text check (outcome is null or outcome in ('replied', 'meeting', 'declined', 'no_response', 'opted_out')),
  outcome_recorded_by uuid,
  outcome_recorded_at timestamptz,
  created_by         uuid not null,
  created_at         timestamptz not null default now(),
  check (position(disclosure_line in body) > 0 and position(opt_out_line in body) > 0),
  check ((kind = 'staging_offer') = (scan_id is null)),
  check ((status = 'draft') = (approved_by is null)),
  check ((status in ('draft', 'approved')) = (sent_recorded_by is null)),
  check ((status = 'outcome_recorded') = (outcome is not null)),
  check ((approved_by is null) = (approved_at is null)),
  check ((sent_recorded_by is null) = (sent_recorded_at is null and sent_channel is null)),
  check ((outcome_recorded_by is null) = (outcome_recorded_at is null and outcome is null))
);
create index if not exists insight_outreach_drafts_target on insight_outreach_drafts (target_id);

create or replace function insight_outreach_rules()
returns trigger language plpgsql as $$
declare
  t insight_targets;
  s insight_scans;
  rank_old int;
  rank_new int;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'An outreach draft is never deleted; it is erased with its workspace' using errcode = '42501';
  end if;
  select * into t from insight_targets where id = new.target_id;
  if tg_op = 'INSERT' then
    if t.do_not_contact then
      raise exception 'This target is marked do not contact' using errcode = '42501';
    end if;
    if new.status <> 'draft' then
      raise exception 'An outreach draft arrives as a draft' using errcode = '42501';
    end if;
    if new.scan_id is not null then
      select * into s from insight_scans where id = new.scan_id;
      if not found or s.target_id <> new.target_id or s.status <> 'graded' then
        raise exception 'An outreach draft speaks only of a graded scan of its own target' using errcode = '42501';
      end if;
    elsif t.category not in ('B', 'C') then
      raise exception 'A staging offer is for a Category B or C target, which is never scanned' using errcode = '42501';
    end if;
    return new;
  end if;
  -- UPDATE: the text is frozen; the status moves forward one step at a time.
  if (to_jsonb(new) - array['status', 'approved_by', 'approved_at', 'sent_recorded_by', 'sent_recorded_at', 'sent_channel', 'outcome', 'outcome_recorded_by', 'outcome_recorded_at'])
     is distinct from (to_jsonb(old) - array['status', 'approved_by', 'approved_at', 'sent_recorded_by', 'sent_recorded_at', 'sent_channel', 'outcome', 'outcome_recorded_by', 'outcome_recorded_at']) then
    raise exception 'An outreach draft''s text is frozen; write a new draft instead' using errcode = '42501';
  end if;
  rank_old := array_position(array['draft', 'approved', 'sent_recorded', 'outcome_recorded'], old.status);
  rank_new := array_position(array['draft', 'approved', 'sent_recorded', 'outcome_recorded'], new.status);
  if rank_new <> rank_old + 1 then
    raise exception 'An outreach draft moves draft, approved, sent, outcome — one step, forward only' using errcode = '42501';
  end if;
  if new.status in ('approved', 'sent_recorded') and t.do_not_contact then
    raise exception 'This target is marked do not contact' using errcode = '42501';
  end if;
  if (old.approved_by is not null and new.approved_by is distinct from old.approved_by)
     or (old.sent_recorded_by is not null and (new.sent_recorded_by, new.sent_recorded_at, new.sent_channel) is distinct from (old.sent_recorded_by, old.sent_recorded_at, old.sent_channel)) then
    raise exception 'A recorded step is never rewritten' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists insight_outreach_rules on insight_outreach_drafts;
create trigger insight_outreach_rules before insert or update or delete on insight_outreach_drafts
  for each row execute function insight_outreach_rules();
drop trigger if exists insight_outreach_same_workspace on insight_outreach_drafts;
create trigger insight_outreach_same_workspace before insert or update on insight_outreach_drafts for each row
  execute function refuse_cross_workspace('target_id', 'insight_targets');

alter table insight_outreach_drafts enable row level security;
drop policy if exists insight_outreach_drafts_select on insight_outreach_drafts;
create policy insight_outreach_drafts_select on insight_outreach_drafts for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table insight_outreach_drafts from public, anon, authenticated;

-- 3. Handoffs: the target, evaluated with its owner's authorisation as an ordinary agent ----------

create table if not exists insight_handoffs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces (id) on delete cascade,
  target_id        uuid not null references insight_targets (id) on delete cascade,
  agent_id         uuid not null references agents (id) on delete cascade,
  created_by       uuid not null,
  created_by_role  text not null check (created_by_role in ('owner', 'admin', 'operator')),
  note             text check (note is null or length(note) <= 1000),
  created_at       timestamptz not null default now(),
  unique (target_id, agent_id)
);

drop trigger if exists insight_handoffs_append_only on insight_handoffs;
create trigger insight_handoffs_append_only before update or delete on insight_handoffs
  for each row execute function refuse_mutation();
drop trigger if exists insight_handoffs_same_workspace_target on insight_handoffs;
create trigger insight_handoffs_same_workspace_target before insert on insight_handoffs for each row
  execute function refuse_cross_workspace('target_id', 'insight_targets');
drop trigger if exists insight_handoffs_same_workspace_agent on insight_handoffs;
create trigger insight_handoffs_same_workspace_agent before insert on insight_handoffs for each row
  execute function refuse_cross_workspace('agent_id', 'agents');

alter table insight_handoffs enable row level security;
drop policy if exists insight_handoffs_select on insight_handoffs;
create policy insight_handoffs_select on insight_handoffs for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table insight_handoffs from public, anon, authenticated;

-- 4. At most 10 scans queued per workspace in any 24 hours ---------------------------------------

create or replace function insight_scans_workspace_cap()
returns trigger language plpgsql as $$
begin
  -- One queue at a time per workspace, so racing inserts count each other.
  perform pg_advisory_xact_lock(hashtextextended('insight-scan-cap:' || new.workspace_id::text, 0));
  if (select count(*) from insight_scans where workspace_id = new.workspace_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'At most 10 insight scans are queued per workspace in 24 hours' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists insight_scans_workspace_cap on insight_scans;
create trigger insight_scans_workspace_cap before insert on insight_scans
  for each row execute function insight_scans_workspace_cap();

-- 5. A fix suggestion is model work, counted like the rest -----------------------------------------

alter table model_operations drop constraint if exists model_operations_operation_check;
alter table model_operations add constraint model_operations_operation_check
  check (operation in ('diagnose', 'draft', 'extract', 'assistant', 'insight_grade', 'insight_fix'));
comment on column model_operations.operation is
  'What the model work was: a diagnosis, a draft from a policy, a Suite Builder extraction, an Ask Novera answer, '
  'the grading of one insight-scan reply (insight_grade, 0082), or a fix suggestion for one (insight_fix, 0085).';
