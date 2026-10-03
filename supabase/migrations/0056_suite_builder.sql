-- The Suite Builder: a customer-approved suite from curated packs, the customer's own
-- documents, what the agent was observed doing, and production failures — without a
-- generated assumption ever passing for the customer's approved policy.
--
-- Built on scenario_drafts (0022/0030/0031), not beside it: a builder candidate is a
-- draft, decided by the same trigger, promoted by the same rule. Three tables hold what
-- had no home: a build, its sources, and the obligations (with their open questions)
-- read from those sources. Audit: docs/audits/2026-10-03-suite-builder.md.

-- ------------------------------------------------------------------ suites
--
-- What a suite's authority rests on, said by the row rather than inferred:
--   curated            shipped with the product, versioned in the repository
--   customer_supplied  a complete suite file a member uploaded (0014)
--   customer_approved  assembled from drafts, each approved by a named person
--   exploratory        a builder's drafts run before approval; never sealed as a report

alter table suites add column if not exists approval text not null default 'customer_supplied';

update suites set approval = case
  when workspace_id is null then 'curated'
  when provenance ? 'promoted_by' then 'customer_approved'
  else 'customer_supplied'
end;

alter table suites drop constraint if exists suites_approval_check;
alter table suites add constraint suites_approval_check check (
  approval in ('curated', 'customer_supplied', 'customer_approved', 'exploratory')
  and ((workspace_id is null) = (approval = 'curated'))
  and (approval <> 'exploratory' or provenance ? 'build_id')
  and (approval <> 'customer_approved' or provenance ? 'promoted_by')
);

comment on column suites.approval is
  'What this suite''s authority rests on: curated (shipped), customer_supplied (a file a member '
  'uploaded), customer_approved (drafts each approved by a named person), exploratory (run '
  'before approval; refused a report by reports_not_exploratory).';

-- A built-in suite is curated by definition; the seeder need not say so.
create or replace function suites_default_approval()
returns trigger language plpgsql as $$
begin
  if new.workspace_id is null then
    new.approval := 'curated';
  end if;
  return new;
end;
$$;

drop trigger if exists suites_default_approval on suites;
create trigger suites_default_approval before insert on suites
  for each row execute function suites_default_approval();

-- A suite version is what every score that cites it is out of. Until now that rested on
-- no code path updating one; now the database refuses it.
create or replace function suites_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and erasing_workspace() then
    return old;
  end if;
  raise exception 'A suite version is immutable; publish a new version instead'
    using errcode = '42501';
end;
$$;

drop trigger if exists suites_immutable on suites;
create trigger suites_immutable before update or delete on suites
  for each row execute function suites_immutable();

-- ------------------------------------------------------------------ builds

create table if not exists suite_builds (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  -- Who the suite is for, when an agency prepares it for a client. Shown on publish.
  prepared_for    text check (prepared_for is null or length(prepared_for) <= 120),
  goal            text check (goal is null or goal in ('own_agent', 'client_delivery', 'governance')),
  -- The curated pack it started from, if any; frozen.
  pack_key        text,
  pack_version    integer,
  quick           boolean not null default false,
  agent_id        uuid references agents (id) on delete restrict,
  scope           text check (scope is null or length(scope) <= 2000),
  status          text not null default 'draft'
                  check (status in ('draft', 'approved', 'published', 'abandoned')),
  -- Publishing with open questions is allowed only as a named, reasoned decision.
  gaps_accepted_by     uuid references auth.users (id),
  gaps_accepted_at     timestamptz,
  gaps_accepted_reason text,
  -- "This is testing evidence, not a legal certification", acknowledged by a person.
  acknowledged_by uuid references auth.users (id),
  acknowledged_at timestamptz,
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz,
  published_suite_id uuid references suites (id) on delete restrict,
  published_by    uuid references auth.users (id),
  published_at    timestamptz,
  abandoned_by    uuid references auth.users (id),
  abandoned_at    timestamptz,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  check ((pack_key is null) = (pack_version is null))
);

create index if not exists suite_builds_workspace_idx on suite_builds (workspace_id, created_at desc);

-- ------------------------------------------------------------------ sources
--
-- What a draft may quote. Stored as parsed, redacted text with the hash of what arrived;
-- the original bytes are never kept. A URL is fetched once, on a member's request, after
-- they confirm they may have it fetched.

create table if not exists suite_sources (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  build_id        uuid not null references suite_builds (id) on delete restrict,
  kind            text not null check (kind in ('pasted', 'upload', 'url', 'tool_schema', 'agent_observation')),
  title           text not null check (length(btrim(title)) between 1 and 200),
  -- A filename, a URL, or the agent an observation is about.
  locator         text check (locator is null or length(locator) <= 2000),
  media_type      text,
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size       integer not null check (byte_size >= 0),
  status          text not null default 'uploaded' check (status in ('uploaded', 'parsed', 'failed')),
  parse_error     text,
  -- Redacted before storage, so what a model is later sent is what is stored.
  text            text check (text is null or length(text) <= 400000),
  text_sha256     text check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$'),
  redaction       jsonb,
  -- For a URL: where it ended, the redirects followed, the robots.txt decision.
  retrieval       jsonb,
  authorisation   text not null,
  authorised_by   uuid not null references auth.users (id),
  authorised_at   timestamptz not null default now(),
  -- How many parts of the text have been read for obligations, front to back.
  extracted_parts integer not null default 0 check (extracted_parts >= 0),
  content_expired_at timestamptz,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  check (status <> 'parsed' or (text is not null or content_expired_at is not null)),
  check (status <> 'failed' or coalesce(btrim(parse_error), '') <> '')
);

create index if not exists suite_sources_build_idx on suite_sources (build_id, created_at);

create or replace function suite_sources_forward_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'A source cannot be deleted; it is part of how a suite came to be';
  end if;

  if new.kind is distinct from old.kind or new.build_id is distinct from old.build_id
  or new.title is distinct from old.title or new.locator is distinct from old.locator
  or new.original_sha256 is distinct from old.original_sha256 or new.byte_size is distinct from old.byte_size
  or new.authorisation is distinct from old.authorisation or new.authorised_by is distinct from old.authorised_by
  or new.authorised_at is distinct from old.authorised_at
  or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'A source''s origin and authorisation are frozen';
  end if;

  if new.extracted_parts < old.extracted_parts then
    raise exception 'Extraction progress only moves forward';
  end if;

  if old.status = 'uploaded' then
    if new.status not in ('uploaded', 'parsed', 'failed') then
      raise exception 'A source becomes parsed or failed, not %', new.status;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'A % source cannot become %', old.status, new.status;
  end if;

  -- After parsing the text is frozen; the retention pass may only empty it.
  if new.text is distinct from old.text or new.text_sha256 is distinct from old.text_sha256
  or new.redaction is distinct from old.redaction or new.retrieval is distinct from old.retrieval
  or new.media_type is distinct from old.media_type or new.parse_error is distinct from old.parse_error
  or new.content_expired_at is distinct from old.content_expired_at then
    if current_setting('novera.expiring_raw', true) = 'on' and new.text is null
       and new.content_expired_at is not null
       and new.text_sha256 is not distinct from old.text_sha256
       and new.redaction is not distinct from old.redaction and new.retrieval is not distinct from old.retrieval then
      return new;
    end if;
    raise exception 'A parsed source is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists suite_sources_forward_only on suite_sources;
create trigger suite_sources_forward_only before update or delete on suite_sources
  for each row execute function suite_sources_forward_only();

-- ------------------------------------------------------------------ obligations
--
-- A passage of a source, what it is read as meaning, and the question a person must
-- answer when the passage does not settle it. A model's reading is a draft; the answer
-- is the customer's.

create table if not exists suite_obligations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  build_id        uuid not null references suite_builds (id) on delete restrict,
  source_id       uuid not null references suite_sources (id) on delete restrict,
  -- Verbatim from the source's stored text; checked on insert.
  passage         text not null check (length(passage) between 1 and 4000),
  locator         text,
  interpretation  text not null check (length(btrim(interpretation)) between 1 and 2000),
  obligation      text,
  duty_refs       jsonb not null default '[]'::jsonb,
  question        text check (question is null or length(question) <= 1000),
  -- Each {answer, citation}; a citation is verbatim from the same source.
  suggested_answers jsonb not null default '[]'::jsonb,
  -- Flags the reader should see: an instruction-shaped passage, a conflict with what
  -- the agent was observed doing.
  flags           jsonb not null default '[]'::jsonb,
  status          text not null check (status in ('drafted', 'open', 'answered', 'not_applicable')),
  answer          text check (answer is null or length(answer) <= 2000),
  answered_by     uuid references auth.users (id),
  answered_at     timestamptz,
  not_applicable_reason text,
  not_applicable_by uuid references auth.users (id),
  not_applicable_at timestamptz,
  model           text,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  check ((status = 'open') = (question is not null and answer is null and not_applicable_at is null))
);

create index if not exists suite_obligations_build_idx on suite_obligations (build_id, created_at);

create or replace function suite_obligations_checked()
returns trigger language plpgsql as $$
declare
  src text;
  src_build uuid;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'An obligation cannot be deleted; mark it not applicable, which records who and why';
  end if;

  if tg_op = 'INSERT' then
    select s.text, s.build_id into src, src_build from suite_sources s where s.id = new.source_id;
    if src_build is distinct from new.build_id then
      raise exception 'An obligation''s source must belong to the same build';
    end if;
    if src is null or position(new.passage in src) = 0 then
      raise exception 'An obligation must quote its source word for word'
        using errcode = '23514';
    end if;
    if new.status not in ('drafted', 'open') then
      raise exception 'An obligation arrives drafted or open, never already decided';
    end if;
    return new;
  end if;

  if new.passage is distinct from old.passage or new.source_id is distinct from old.source_id
  or new.build_id is distinct from old.build_id or new.interpretation is distinct from old.interpretation
  or new.question is distinct from old.question or new.suggested_answers is distinct from old.suggested_answers
  or new.flags is distinct from old.flags or new.obligation is distinct from old.obligation
  or new.duty_refs is distinct from old.duty_refs or new.model is distinct from old.model
  or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'An extracted obligation is frozen; only its decision moves';
  end if;

  if old.status in ('answered', 'not_applicable') and new is distinct from old then
    raise exception 'A decided obligation stays decided';
  end if;
  if old.status = 'drafted' and new.status not in ('drafted', 'not_applicable') then
    raise exception 'An obligation without a question can only be marked not applicable';
  end if;
  if new.status = 'answered' and (new.answered_by is null or new.answered_at is null
                                  or coalesce(btrim(new.answer), '') = '') then
    raise exception 'An answer must record who gave it, when, and what it is';
  end if;
  if new.status = 'not_applicable' and (new.not_applicable_by is null or new.not_applicable_at is null
                                        or coalesce(btrim(new.not_applicable_reason), '') = '') then
    raise exception 'Not applicable must record who decided, when, and why';
  end if;
  return new;
end;
$$;

drop trigger if exists suite_obligations_checked on suite_obligations;
create trigger suite_obligations_checked before insert or update or delete on suite_obligations
  for each row execute function suite_obligations_checked();

-- ------------------------------------------------------------------ scenario_drafts

alter table scenario_drafts
  add column if not exists build_id uuid references suite_builds (id) on delete restrict,
  add column if not exists source_id uuid references suite_sources (id) on delete restrict,
  add column if not exists obligation_id uuid references suite_obligations (id) on delete restrict,
  -- A pack candidate: {pack_key, pack_version, case_id}.
  add column if not exists source_ref jsonb,
  -- What a reader must see before deciding: [{observed, declared, action}] and flags.
  add column if not exists conflicts jsonb not null default '[]'::jsonb,
  add column if not exists edited_from uuid references scenario_drafts (id) on delete restrict,
  add column if not exists review_note text,
  add column if not exists review_requested_by uuid references auth.users (id),
  -- Set on every draft one bulk approval decided, and named in the audit trail.
  add column if not exists approval_group uuid,
  add column if not exists not_applicable_by uuid references auth.users (id),
  add column if not exists not_applicable_at timestamptz,
  add column if not exists not_applicable_reason text;

create index if not exists scenario_drafts_build_idx on scenario_drafts (build_id, created_at) where build_id is not null;

alter table scenario_drafts drop constraint if exists scenario_drafts_status_check;
alter table scenario_drafts add constraint scenario_drafts_status_check
  check (status in ('draft', 'needs_review', 'approved', 'rejected', 'not_applicable', 'included'));

alter table scenario_drafts drop constraint if exists scenario_drafts_origin_check;
alter table scenario_drafts add constraint scenario_drafts_origin_check
  check (origin in ('policy', 'import', 'production', 'pack', 'document', 'discovery'));

alter table scenario_drafts drop constraint if exists scenario_drafts_origin_proof;
alter table scenario_drafts add constraint scenario_drafts_origin_proof check (
  (origin = 'policy' and policy_id is not null and source_quote is not null
     and import_provenance is null and production_failure_id is null
     and source_id is null and source_ref is null)
  or
  (origin = 'import' and policy_id is null and source_quote is null and production_failure_id is null
     and import_provenance is not null
     and import_provenance ? 'source_tool'
     and import_provenance ? 'original_hash'
     and import_provenance ? 'item_hash'
     and source_id is null and source_ref is null)
  or
  (origin = 'production' and production_failure_id is not null
     and policy_id is null and source_quote is null and import_provenance is null
     and source_id is null and source_ref is null)
  or
  (origin = 'pack' and build_id is not null
     and source_ref ? 'pack_key' and source_ref ? 'pack_version' and source_ref ? 'case_id'
     and policy_id is null and import_provenance is null and production_failure_id is null
     and source_id is null)
  or
  (origin = 'document' and build_id is not null and source_id is not null and obligation_id is not null
     and source_quote is not null
     and policy_id is null and import_provenance is null and production_failure_id is null and source_ref is null)
  or
  (origin = 'discovery' and build_id is not null and source_id is not null and source_quote is not null
     and policy_id is null and import_provenance is null and production_failure_id is null and source_ref is null)
);

-- Nothing arrives decided. Until now the forward-only rule ran on update only, so an
-- insert could carry `approved`; a model's output, an import or a prompt-injected
-- document can now only ever arrive as a draft.
create or replace function scenario_drafts_arrive_undecided()
returns trigger language plpgsql as $$
declare
  src text;
  src_build uuid;
  ob_source uuid;
begin
  if new.status not in ('draft', 'needs_review') then
    raise exception 'A scenario draft arrives as a draft, never already %', new.status
      using errcode = '42501';
  end if;
  if new.approved_by is not null or new.approved_at is not null or new.approval_group is not null
  or new.rejected_by is not null or new.not_applicable_by is not null or new.included_in_suite_id is not null then
    raise exception 'A scenario draft arrives undecided' using errcode = '42501';
  end if;
  if new.status = 'needs_review' and coalesce(btrim(new.review_note), '') = '' then
    raise exception 'A draft that needs review must say what needs deciding';
  end if;

  if new.origin in ('document', 'discovery') then
    select s.text, s.build_id into src, src_build from suite_sources s where s.id = new.source_id;
    if src_build is distinct from new.build_id then
      raise exception 'A draft''s source must belong to its build';
    end if;
    if src is null or position(new.source_quote in src) = 0 then
      raise exception 'A draft must quote its source word for word' using errcode = '23514';
    end if;
  end if;
  if new.obligation_id is not null then
    select o.source_id into ob_source from suite_obligations o where o.id = new.obligation_id;
    if ob_source is distinct from new.source_id then
      raise exception 'A draft''s obligation must come from the same source';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scenario_drafts_arrive_undecided on scenario_drafts;
create trigger scenario_drafts_arrive_undecided before insert on scenario_drafts
  for each row execute function scenario_drafts_arrive_undecided();

create or replace function scenario_drafts_forward_only()
returns trigger language plpgsql as $$
declare
  blocked text;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then
      return old;
    end if;
    raise exception 'A scenario draft cannot be deleted; reject it, which records who and why';
  end if;

  if new.scenario is distinct from old.scenario
  or new.source_quote is distinct from old.source_quote
  or new.policy_id is distinct from old.policy_id
  or new.destructive is distinct from old.destructive
  or new.fixture_only is distinct from old.fixture_only
  or new.origin is distinct from old.origin
  or new.import_provenance is distinct from old.import_provenance
  or new.production_failure_id is distinct from old.production_failure_id
  or new.source_id is distinct from old.source_id
  or new.obligation_id is distinct from old.obligation_id
  or new.source_ref is distinct from old.source_ref
  or new.conflicts is distinct from old.conflicts
  or new.edited_from is distinct from old.edited_from
  or new.created_at is distinct from old.created_at then
    raise exception 'A scenario draft is immutable; write a new draft instead of editing this one';
  end if;

  -- A draft may be gathered into one build (a production failure recorded before the
  -- build existed), never moved out of it.
  if old.build_id is not null and new.build_id is distinct from old.build_id then
    raise exception 'A draft cannot move between builds';
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'needs_review', 'approved', 'rejected', 'not_applicable') then
    raise exception 'A draft becomes approved, rejected or not applicable, not %', new.status;
  end if;
  if old.status = 'needs_review' and new.status not in ('needs_review', 'approved', 'rejected', 'not_applicable') then
    raise exception 'A draft that needs review becomes approved, rejected or not applicable, not %', new.status;
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'included') then
    raise exception 'An approved draft cannot return to %', new.status;
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'A rejected draft cannot be revived; draft a new one';
  end if;
  if old.status = 'not_applicable' and new.status <> 'not_applicable' then
    raise exception 'A draft marked not applicable stays so; draft a new one';
  end if;
  if old.status = 'included' and new.status <> 'included' then
    raise exception 'A scenario already in a suite version cannot be withdrawn from it';
  end if;

  if old.status = 'draft' and new.status = 'needs_review'
     and (new.review_requested_by is null or coalesce(btrim(new.review_note), '') = '') then
    raise exception 'Asking for clarification must record who asked and what';
  end if;

  -- A scenario resting on a question nobody has answered cannot be approved: the
  -- answer is the customer's, and approving first would test a guess.
  if new.status = 'approved' and old.status <> 'approved' and new.obligation_id is not null then
    select o.status into blocked from suite_obligations o where o.id = new.obligation_id;
    if blocked in ('open', 'not_applicable') then
      raise exception 'This scenario rests on an obligation that is %; decide it first', replace(blocked, '_', ' ')
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'approved' and (new.approved_by is null or new.approved_at is null) then
    raise exception 'An approval must record who made it and when';
  end if;
  if new.status = 'rejected' and (new.rejected_by is null or new.rejected_at is null
                                  or coalesce(btrim(new.rejection_reason), '') = '') then
    raise exception 'A rejection must record who made it, when, and why';
  end if;
  if new.status = 'not_applicable' and (new.not_applicable_by is null or new.not_applicable_at is null
                                        or coalesce(btrim(new.not_applicable_reason), '') = '') then
    raise exception 'Not applicable must record who decided, when, and why';
  end if;
  if new.status = 'included' and new.included_in_suite_id is null then
    raise exception 'A draft marked as included must name the suite version it entered';
  end if;

  return new;
end;
$$;

drop trigger if exists scenario_drafts_same_workspace on scenario_drafts;
create trigger scenario_drafts_same_workspace before insert or update on scenario_drafts for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'policy_id', 'policies',
    'production_failure_id', 'production_failures', 'included_in_suite_id', 'suites',
    'api_key_id', 'api_keys', 'build_id', 'suite_builds', 'source_id', 'suite_sources',
    'obligation_id', 'suite_obligations', 'edited_from', 'scenario_drafts');

drop trigger if exists suite_builds_same_workspace on suite_builds;
create trigger suite_builds_same_workspace before insert or update on suite_builds for each row
  execute function refuse_cross_workspace('agent_id', 'agents', 'published_suite_id', 'suites');

drop trigger if exists suite_sources_same_workspace on suite_sources;
create trigger suite_sources_same_workspace before insert or update on suite_sources for each row
  execute function refuse_cross_workspace('build_id', 'suite_builds');

drop trigger if exists suite_obligations_same_workspace on suite_obligations;
create trigger suite_obligations_same_workspace before insert or update on suite_obligations for each row
  execute function refuse_cross_workspace('build_id', 'suite_builds', 'source_id', 'suite_sources');

-- ------------------------------------------------------------------ build lifecycle

create or replace function suite_builds_forward_only()
returns trigger language plpgsql as $$
declare
  open_questions integer;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'A build cannot be deleted; abandon it, which records who';
  end if;

  if new.pack_key is distinct from old.pack_key or new.pack_version is distinct from old.pack_version
  or new.quick is distinct from old.quick
  or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Where a build started is frozen';
  end if;

  if old.status in ('published', 'abandoned') and new is distinct from old then
    raise exception 'A % build is final', old.status;
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'published', 'abandoned') then
    raise exception 'An approved build is published or abandoned, not %', new.status;
  end if;
  if old.status = 'approved' and (new.name is distinct from old.name or new.scope is distinct from old.scope
     or new.prepared_for is distinct from old.prepared_for or new.agent_id is distinct from old.agent_id) then
    raise exception 'An approved build is frozen; abandon it and start again to change it';
  end if;

  if new.status in ('approved', 'published') then
    if new.approved_by is null or new.approved_at is null then
      raise exception 'An approved build must name who approved it';
    end if;
    if new.acknowledged_by is null or new.acknowledged_at is null then
      raise exception 'Approving a suite requires acknowledging it is testing evidence, not a certification';
    end if;
    select count(*) into open_questions from suite_obligations o
     where o.build_id = new.id and o.status = 'open';
    if open_questions > 0 and (new.gaps_accepted_by is null or new.gaps_accepted_at is null
                               or coalesce(btrim(new.gaps_accepted_reason), '') = '') then
      raise exception '% open question(s) remain; answer them or accept the gaps by name with a reason', open_questions
        using errcode = '42501';
    end if;
  end if;
  if new.status = 'published' and (new.published_suite_id is null or new.published_by is null or new.published_at is null) then
    raise exception 'A published build must name the suite version it created';
  end if;
  if new.status = 'abandoned' and (new.abandoned_by is null or new.abandoned_at is null) then
    raise exception 'Abandoning a build must record who';
  end if;
  return new;
end;
$$;

drop trigger if exists suite_builds_forward_only on suite_builds;
create trigger suite_builds_forward_only before update or delete on suite_builds
  for each row execute function suite_builds_forward_only();

-- ------------------------------------------------------------------ exploratory scans

create or replace function reports_not_exploratory()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from runs r join suites s on s.id = r.suite_id
              where r.id = new.run_id and s.approval = 'exploratory') then
    raise exception 'An exploratory scan is not a conformity report and is never sealed as one'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_not_exploratory on reports;
create trigger reports_not_exploratory before insert on reports
  for each row execute function reports_not_exploratory();

create or replace function run_schedules_not_exploratory()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from suites s where s.id = new.suite_id and s.approval = 'exploratory') then
    raise exception 'An exploratory scan cannot be scheduled; publish the suite first'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists run_schedules_not_exploratory on run_schedules;
create trigger run_schedules_not_exploratory before insert or update on run_schedules
  for each row execute function run_schedules_not_exploratory();

-- ------------------------------------------------------------------ access

alter table suite_builds      enable row level security;
alter table suite_sources     enable row level security;
alter table suite_obligations enable row level security;

-- Read by members; written only by the server, behind the role checks in
-- src/lib/auth/permissions.ts, so a decision always carries a checked name.
drop policy if exists suite_builds_select on suite_builds;
create policy suite_builds_select on suite_builds for select using (is_workspace_member(workspace_id));
drop policy if exists suite_sources_select on suite_sources;
create policy suite_sources_select on suite_sources for select using (is_workspace_member(workspace_id));
drop policy if exists suite_obligations_select on suite_obligations;
create policy suite_obligations_select on suite_obligations for select using (is_workspace_member(workspace_id));

comment on table suite_builds is
  'A Suite Builder session: a pack, sources, candidates, decisions, and the suite version it '
  'published. draft -> approved -> published, or abandoned; publishing with open questions '
  'needs a named, reasoned acceptance.';
comment on table suite_sources is
  'What builder drafts may quote: pasted text, an upload, one fetched page, a tool schema, or '
  'an observation of the agent. Parsed and redacted text with the original''s SHA-256; the '
  'original bytes are never stored. Text expires after 180 days.';
comment on table suite_obligations is
  'A verbatim passage of a source, its drafted interpretation, and an open question when the '
  'passage does not settle what the agent should do. The answer is the customer''s.';

-- ------------------------------------------------------------------ erasure
--
-- Every table that refuses deletion needs an erasure path in the same migration.
-- 0054's body exactly, plus the builder's three tables after the drafts that name them.

create or replace function erase_workspace(target uuid, requested_by uuid default null)
returns erasure_log
language plpgsql
security definer
set search_path = public
as $$
declare
  record erasure_log;
  n_agents integer;
  n_runs integer;
  n_cases integer;
  n_reports integer;
begin
  select count(*) into n_agents from agents where workspace_id = target;
  select count(*) into n_runs from runs where workspace_id = target;
  select count(*) into n_cases from run_cases where workspace_id = target;
  select count(*) into n_reports from reports where workspace_id = target;

  perform set_config('novera.erasing', 'on', true);

  -- 0054's tables first: they reference runs' neighbours only through the workspace.
  delete from assistant_memory_candidates where workspace_id = target;
  delete from assistant_memory      where workspace_id = target;
  delete from assistant_threads     where workspace_id = target;
  delete from workspace_invitations where workspace_id = target;
  delete from audit_events          where workspace_id = target;
  -- A profile pointing here loses the default, not the profile.
  update user_profiles set default_workspace_id = null where default_workspace_id = target;
  update user_profiles set default_agent_id = null
   where default_agent_id in (select id from agents where workspace_id = target);


  -- Before the endpoints they belong to.
  delete from webhook_deliveries    where workspace_id = target;
  delete from webhook_endpoints     where workspace_id = target;
  delete from reports               where workspace_id = target;
  delete from diagnoses             where workspace_id = target;
  delete from case_retests          where workspace_id = target;
  delete from evidence_observations where workspace_id = target;
  -- Before run_cases, which it references.
  delete from verdict_reviews       where workspace_id = target;
  delete from run_cases             where workspace_id = target;
  delete from runs                  where workspace_id = target;
  -- After the runs that name them, before the agents and suites they name.
  delete from run_schedules         where workspace_id = target;
  delete from probes                where workspace_id = target;
  delete from scenario_drafts       where workspace_id = target;
  -- 0056: after the drafts that name them, before the agents and suites they name.
  delete from suite_obligations     where workspace_id = target;
  delete from suite_sources         where workspace_id = target;
  delete from suite_builds          where workspace_id = target;
  -- After the drafts that reference it, before the agents it references.
  delete from production_failures   where workspace_id = target;
  delete from api_keys              where workspace_id = target;
  delete from policies              where workspace_id = target;
  delete from secrets               where workspace_id = target;
  delete from agents                where workspace_id = target;
  delete from suites                where workspace_id = target;
  delete from workspace_members     where workspace_id = target;
  delete from workspaces            where id = target;

  perform set_config('novera.erasing', 'off', true);

  insert into erasure_log (workspace_id, requested_by, agents_removed, runs_removed, cases_removed, reports_removed)
  values (target, requested_by, n_agents, n_runs, n_cases, n_reports)
  returning * into record;

  return record;
end;
$$;

-- ------------------------------------------------------------------ retention
--
-- 0054's body exactly, plus: a source's text is emptied 180 days after it arrived. Its
-- hashes, the passages its obligations quote and the drafts made from it stay.

create or replace function expire_inbound_and_probes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - interval '90 days';
  target uuid;
  n_requests integer := 0;
  n_probes integer;
  n_threads integer;
  n_memory integer;
  n_sources integer;
begin
  for target in
    select r.id from inbound_requests r
    where greatest(
      r.created_at,
      coalesce((select max(greatest(d.created_at, coalesce(d.approved_at, d.created_at), coalesce(d.sent_at, d.created_at)))
                from reply_drafts d where d.request_id = r.id), r.created_at)
    ) < cutoff
  loop
    perform erase_inbound_request(target, null, 'retention');
    n_requests := n_requests + 1;
  end loop;

  perform set_config('novera.expiring_raw', 'on', true);
  update probes
     set response_body = null, response_headers = null, response_shape = null, content_expired_at = now()
   where content_expired_at is null and created_at < cutoff;
  get diagnostics n_probes = row_count;
  update suite_sources
     set text = null, content_expired_at = now()
   where content_expired_at is null and text is not null and created_at < now() - interval '180 days';
  get diagnostics n_sources = row_count;
  perform set_config('novera.expiring_raw', 'off', true);

  delete from assistant_threads where last_message_at < now() - interval '180 days';
  get diagnostics n_threads = row_count;
  delete from assistant_memory where expires_at is not null and expires_at < now();
  get diagnostics n_memory = row_count;

  return jsonb_build_object('requests', n_requests, 'probes', n_probes, 'assistant_threads', n_threads,
                            'assistant_memory', n_memory, 'suite_sources', n_sources);
end;
$$;
