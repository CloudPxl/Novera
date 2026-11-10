-- Public-demo insight scans (2026-11-10).
--
-- Novera's own browser worker chats with a vendor's PUBLIC demo chatbot — six scripted prompts in
-- one session, at least twelve seconds apart, declared by User-Agent, robots.txt honoured, ending
-- the moment a widget asks for a login or a payment or shows a bot challenge — and each reply is
-- redacted and graded by the AI graders. The worker runs outside the web app and holds one HMAC
-- secret; it never sees a model key or the service role.
--
-- Never a run, never a report: no `run_id` and no `report_id` exist in these tables, so nothing can
-- seal one (the exploratory scan's posture, 0056; the single-scenario check's, 0072). The
-- authorisation basis is the vendor's published demo, recorded with the operator's user id and
-- role — never the owner's consent, which these rows cannot claim.
--
-- Erasure: every row hangs off workspaces (id) on delete cascade; erase_workspace() deletes the
-- workspace last under novera.erasing, so the cascaded deletes pass refuse_mutation() (0005), as
-- ci_triggers (0070) and the pilot redemptions (0075) do. Its body is not redefined here.
-- Retention: not in the 0037 pass — a reply is stored already redacted and the prompt is a scripted
-- scenario, not a customer's message. Revisit if customer-origin text ever lands here.

-- 1. Targets: a public demo bot, classified from facts ----------------------------------------

create table if not exists insight_targets (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references workspaces (id) on delete cascade,
  name                 text not null check (length(name) between 1 and 200 and name !~ '[[:cntrl:]]'),
  demo_url             text not null check (demo_url ~ '^https://' and length(demo_url) <= 2048),
  sector               text check (sector is null or length(sector) <= 100),
  -- The yes/no facts the category is derived from (src/lib/insight/classify.ts). Never the category itself.
  facts                jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  category             text not null check (category in ('A', 'B', 'C', 'D')),
  category_reasons     text[] not null default '{}',
  authorisation_basis  text not null check (authorisation_basis = 'published_public_demo'),
  authorised_by        uuid not null,
  authorised_by_role   text not null check (authorised_by_role in ('owner', 'admin', 'operator', 'reviewer', 'auditor')),
  -- Set once by a person; never withdrawn. No scan and no outreach draft after it.
  do_not_contact       boolean not null default false,
  notes                text check (notes is null or length(notes) <= 4000),
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, demo_url)
);

comment on table insight_targets is
  'A public demo chatbot an operator may scan: classified A–D from recorded facts, never chosen. '
  'Authorisation basis is the vendor''s published demo, with the operator''s user id and role — never the owner''s consent. '
  'Identity and basis are frozen; do_not_contact is never withdrawn; erased only with the workspace.';

create or replace function insight_targets_frozen()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'An insight target is never deleted; it is erased with its workspace' using errcode = '42501';
  end if;
  if new.workspace_id <> old.workspace_id or new.demo_url <> old.demo_url or new.name <> old.name
     or new.authorisation_basis <> old.authorisation_basis or new.authorised_by <> old.authorised_by
     or new.authorised_by_role <> old.authorised_by_role or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'An insight target''s identity and authorisation basis are frozen' using errcode = '42501';
  end if;
  if old.do_not_contact and not new.do_not_contact then
    raise exception 'do_not_contact is never withdrawn' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists insight_targets_frozen on insight_targets;
create trigger insight_targets_frozen before update or delete on insight_targets
  for each row execute function insight_targets_frozen();

alter table insight_targets enable row level security;
drop policy if exists insight_targets_select on insight_targets;
create policy insight_targets_select on insight_targets for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table insight_targets from public, anon, authenticated;

-- 2. Scans: one declared session of the suite against a target --------------------------------

create table if not exists insight_scans (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  target_id       uuid not null references insight_targets (id) on delete cascade,
  -- Declared before anything is typed: which suite, which version, its digest, which scenarios in order.
  suite_key       text not null check (suite_key ~ '^[a-z0-9][a-z0-9-]*$'),
  suite_version   integer not null check (suite_version >= 1),
  suite_digest    text not null check (suite_digest ~ '^[0-9a-f]{64}$'),
  scenario_ids    text[] not null check (cardinality(scenario_ids) between 1 and 12),
  status          text not null default 'queued'
                  check (status in ('queued', 'running', 'graded', 'aborted', 'error')),
  -- The worker holding the scan, its fence token and lease (0047's posture for runs).
  claimed_by      text,
  lease_token     uuid,
  lease_until     timestamptz,
  last_turn_at    timestamptz,
  turns_recorded  integer not null default 0 check (turns_recorded >= 0),
  -- What robots.txt said: the server's own check at claim, and the worker's cross-check.
  robots          jsonb check (robots is null or (jsonb_typeof(robots) = 'object' and octet_length(robots::text) <= 2000)),
  -- Where the page ended up and which widget was found: final_url, title, vendor, selector path. Never HTML.
  page            jsonb check (page is null or (jsonb_typeof(page) = 'object' and octet_length(page::text) <= 4000)),
  error_kind      text check (error_kind is null or error_kind in (
                    'robots_disallowed', 'address_refused', 'target_refused', 'page_load_failed', 'redirected_offsite',
                    'blocked_challenge', 'widget_not_found', 'blocked_login', 'blocked_payment', 'lease_expired', 'worker_error')),
  error_detail    text check (error_detail is null or length(error_detail) <= 500),
  aborted_reason  text check (aborted_reason is null or length(aborted_reason) between 3 and 500),
  started_by      uuid not null,
  started_by_role text not null check (started_by_role in ('owner', 'admin', 'operator', 'reviewer', 'auditor')),
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  check ((status = 'error') = (error_kind is not null)),
  check ((status = 'aborted') = (aborted_reason is not null)),
  check ((status in ('queued', 'running')) = (finished_at is null))
);

comment on table insight_scans is
  'One declared session of the public-insight suite against a target, driven by the browser worker. '
  'Never a run and never a report: no run_id, no report_id. queued → running (claimed) → graded | aborted | error; '
  'a finished scan does not change. Erased only with the workspace.';

create unique index if not exists insight_scans_one_active_per_target
  on insight_scans (target_id) where status in ('queued', 'running');
create index if not exists insight_scans_queue
  on insight_scans (created_at) where status = 'queued';
create index if not exists insight_scans_by_target
  on insight_scans (target_id, created_at desc);

create or replace function insight_scans_forward_only()
returns trigger language plpgsql as $$
declare
  missing integer;
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'An insight scan is never deleted; it is erased with its workspace' using errcode = '42501';
  end if;
  if new.workspace_id <> old.workspace_id or new.target_id <> old.target_id or new.suite_key <> old.suite_key
     or new.suite_version <> old.suite_version or new.suite_digest <> old.suite_digest
     or new.scenario_ids <> old.scenario_ids or new.started_by <> old.started_by
     or new.started_by_role <> old.started_by_role or new.created_at <> old.created_at then
    raise exception 'An insight scan''s declaration is frozen' using errcode = '42501';
  end if;
  if old.status in ('graded', 'aborted', 'error') then
    raise exception 'A finished insight scan does not change' using errcode = '42501';
  end if;
  if old.status = 'queued' and new.status = 'graded' then
    raise exception 'A queued scan is claimed, aborted or refused; it is never graded' using errcode = '42501';
  end if;
  if old.status = 'running' and new.status = 'queued' then
    raise exception 'A claimed scan does not return to the queue' using errcode = '42501';
  end if;
  if new.status = 'graded' then
    select count(*) into missing
      from unnest(old.scenario_ids) as s(id)
     where not exists (select 1 from insight_observations o where o.scan_id = old.id and o.scenario_id = s.id);
    if missing > 0 then
      raise exception 'A scan is graded only when every declared scenario has an observation (% missing)', missing
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists insight_scans_forward_only on insight_scans;
create trigger insight_scans_forward_only before update or delete on insight_scans
  for each row execute function insight_scans_forward_only();

drop trigger if exists insight_scans_same_workspace on insight_scans;
create trigger insight_scans_same_workspace before insert or update on insight_scans for each row
  execute function refuse_cross_workspace('target_id', 'insight_targets');

alter table insight_scans enable row level security;
drop policy if exists insight_scans_select on insight_scans;
create policy insight_scans_select on insight_scans for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table insight_scans from public, anon, authenticated;

-- 3. Observations: one scenario's reply as the widget displayed it, redacted, graded ----------

create table if not exists insight_observations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces (id) on delete cascade,
  scan_id           uuid not null references insight_scans (id) on delete cascade,
  scenario_id       text not null,
  -- Exactly the scenario's input, as typed: checked against the suite before the row is written.
  prompt_text       text not null check (length(prompt_text) <= 4000),
  -- Redacted before storage. Null when no reply arrived at all.
  response_text     text check (response_text is null or octet_length(response_text) <= 65536),
  redaction         jsonb not null check (jsonb_typeof(redaction) = 'object'),
  -- How the reply was captured: method, selector path, frame origin, timings, whether it was partial. Never HTML.
  capture           jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(capture) = 'object' and octet_length(capture::text) <= 4000),
  status            text not null check (status in ('pass', 'fail', 'error')),
  rationale         text,
  failed_assertions text[] not null default '{}',
  judge_model       text,
  judge_votes       jsonb not null default '[]'::jsonb check (jsonb_typeof(judge_votes) = 'array'),
  judge_agreement   text check (judge_agreement is null or judge_agreement in ('agreed', 'majority', 'unconfirmed', 'unresolved')),
  settled_by        text check (settled_by is null or settled_by in ('deterministic', 'models')),
  error             text check (error is null or length(error) <= 1000),
  judge_funding     text check (judge_funding is null or judge_funding in ('trial_free', 'workspace_key', 'plan_managed')),
  worker_id         text not null,
  created_at        timestamptz not null default now(),
  unique (scan_id, scenario_id),
  -- 0019's posture: a rule-settled scenario names no judge.
  check (settled_by is distinct from 'deterministic' or (judge_model is null and judge_votes = '[]'::jsonb)),
  -- No reply, or a reply cut short, is never a verdict.
  check (response_text is not null or (status = 'error' and settled_by is null and judge_model is null)),
  check ((capture ->> 'partial') is distinct from 'true' or status = 'error'),
  -- A verdict says what settled it.
  check (status = 'error' or settled_by is not null)
);

comment on table insight_observations is
  'One scenario of an insight scan: the prompt as typed, the reply as the widget displayed it (redacted; null when '
  'none arrived), how it was captured, and the verdict with its graders. Append-only; recorded only while the scan '
  'is running and only for a declared scenario. Erased only with the workspace.';

create or replace function insight_observations_scan_running()
returns trigger language plpgsql as $$
declare
  s insight_scans;
begin
  select * into s from insight_scans where id = new.scan_id;
  if not found or s.status <> 'running' then
    raise exception 'An observation is recorded only while its scan is running' using errcode = '42501';
  end if;
  if not (new.scenario_id = any (s.scenario_ids)) then
    raise exception 'Scenario % is not declared by this scan', new.scenario_id using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists insight_observations_scan_running on insight_observations;
create trigger insight_observations_scan_running before insert on insight_observations
  for each row execute function insight_observations_scan_running();

drop trigger if exists insight_observations_append_only on insight_observations;
create trigger insight_observations_append_only before update or delete on insight_observations
  for each row execute function refuse_mutation();

drop trigger if exists insight_observations_same_workspace on insight_observations;
create trigger insight_observations_same_workspace before insert or update on insight_observations for each row
  execute function refuse_cross_workspace('scan_id', 'insight_scans');

alter table insight_observations enable row level security;
drop policy if exists insight_observations_select on insight_observations;
create policy insight_observations_select on insight_observations for select
  using (is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on table insight_observations from public, anon, authenticated;

-- 4. Workers: which browser worker was last seen, so a page can say whether one is running -----

create table if not exists insight_workers (
  id             text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  host_label     text check (host_label is null or length(host_label) <= 100),
  version        text check (version is null or length(version) <= 40),
  last_seen_at   timestamptz not null default now(),
  scans_claimed  integer not null default 0 check (scans_claimed >= 0),
  created_at     timestamptz not null default now()
);

comment on table insight_workers is
  'Browser workers that have presented the worker secret: id, host label, version, when last seen. '
  'No workspace data. Service role only.';

alter table insight_workers enable row level security;
revoke all on table insight_workers from public, anon, authenticated;

-- 5. Claim, lease and finish: service role only --------------------------------------------------

create or replace function claim_insight_scan(worker text, lease_ms integer)
returns insight_scans
language plpgsql
security definer
set search_path = public
as $$
declare
  s insight_scans;
begin
  -- A worker that stopped reporting: its scan ends as lease_expired, never as a verdict.
  update insight_scans
     set status = 'error', error_kind = 'lease_expired',
         error_detail = 'The browser worker stopped reporting before the scan finished.',
         finished_at = now()
   where status = 'running' and lease_until < now() - interval '5 minutes';

  -- A target reclassified or marked do-not-contact while its scan waited: refused, not run.
  update insight_scans sc
     set status = 'error', error_kind = 'target_refused',
         error_detail = 'The target is no longer scannable: not Category A, or marked do not contact.',
         finished_at = now()
    from insight_targets t
   where t.id = sc.target_id and sc.status = 'queued' and (t.category <> 'A' or t.do_not_contact);

  select sc.* into s
    from insight_scans sc
    join insight_targets t on t.id = sc.target_id
   where sc.status = 'queued' and t.category = 'A' and not t.do_not_contact
   order by sc.created_at
   for update of sc skip locked
   limit 1;
  if not found then
    return null;
  end if;

  update insight_scans
     set status = 'running',
         claimed_by = worker,
         lease_token = gen_random_uuid(),
         lease_until = now() + make_interval(secs => lease_ms / 1000.0)
   where id = s.id
   returning * into s;

  update insight_workers set scans_claimed = scans_claimed + 1, last_seen_at = now() where id = worker;
  return s;
end;
$$;

revoke all on function claim_insight_scan(text, integer) from public, anon, authenticated;
grant execute on function claim_insight_scan(text, integer) to service_role;
comment on function claim_insight_scan(text, integer) is
  'Ends stale leases, refuses queued scans whose target is no longer scannable, then claims the oldest queued scan '
  'for this worker with a fresh lease token. Null when nothing is queued. Service role only.';

create or replace function touch_insight_lease(scan uuid, token uuid, lease_ms integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update insight_scans
     set lease_until = now() + make_interval(secs => lease_ms / 1000.0)
   where id = scan and lease_token = token and status = 'running';
  if found then
    update insight_workers w set last_seen_at = now()
      from insight_scans sc where sc.id = scan and w.id = sc.claimed_by;
  end if;
  return found;
end;
$$;

revoke all on function touch_insight_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function touch_insight_lease(uuid, uuid, integer) to service_role;

create or replace function finish_insight_scan(scan uuid, token uuid, new_status text, kind text, detail text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_status not in ('graded', 'error') then
    raise exception 'A worker finishes a scan as graded or error only' using errcode = '22023';
  end if;
  update insight_scans
     set status = new_status,
         error_kind = case when new_status = 'error' then kind else null end,
         error_detail = case when new_status = 'error' then left(detail, 500) else null end,
         finished_at = now()
   where id = scan and lease_token = token and status = 'running';
  return found;
end;
$$;

revoke all on function finish_insight_scan(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function finish_insight_scan(uuid, uuid, text, text, text) to service_role;

-- 6. Grading a captured reply is model work on the workspace's funding (0059) -------------------

alter table model_operations drop constraint if exists model_operations_operation_check;
alter table model_operations add constraint model_operations_operation_check
  check (operation in ('diagnose', 'draft', 'extract', 'assistant', 'insight_grade'));
comment on column model_operations.operation is
  'What the model work was: a diagnosis, a draft from a policy, a Suite Builder extraction, an Ask Novera answer, '
  'or the grading of one insight-scan reply (insight_grade, 0082).';
