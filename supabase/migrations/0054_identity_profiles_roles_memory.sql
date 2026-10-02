-- Identity: profiles, roles, invitations, an audit trail, assistant history and memory.
-- docs/audits/2026-10-02-identity-and-tenancy.md has the reasoning; this is the model it chose:
-- the workspace stays the tenant, a person may belong to several, each membership has a role,
-- and nothing about a person's preferences ever reaches grading, suites, policies or reports.
--
-- Additive and forward-only. Nothing is dropped or renamed; the one data change ('member' →
-- 'operator') touched zero production rows when written.

-- ===================================================================== roles

-- 'member' meant "can do everything except change retention", which is what an operator is.
alter table workspace_members drop constraint if exists workspace_members_role_check;
update workspace_members set role = 'operator' where role = 'member';
alter table workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'operator', 'reviewer', 'auditor'));
alter table workspace_members alter column role set default 'operator';

-- The signed-in person's role in a workspace, or null. Security definer for the same reason
-- as is_workspace_member: it is called from policies on workspace_members' neighbours.
create or replace function workspace_role(ws uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from workspace_members where workspace_id = ws and user_id = auth.uid();
$$;

create or replace function has_workspace_role(ws uuid, allowed text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role = any(allowed) from workspace_members where workspace_id = ws and user_id = auth.uid()), false);
$$;

-- A workspace has exactly one owner, and it is the user named on the workspace. Ownership
-- transfer is not built; until it is, the owner cannot be removed or demoted except by
-- erasing the workspace.
create or replace function workspace_members_owner_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_owner uuid;
begin
  if erasing_workspace() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    select owner_id into ws_owner from workspaces where id = old.workspace_id;
    if old.user_id = ws_owner then
      raise exception 'The workspace owner cannot be removed. Erase the workspace instead.';
    end if;
    return old;
  end if;
  select owner_id into ws_owner from workspaces where id = new.workspace_id;
  if (new.role = 'owner') <> (new.user_id = ws_owner) then
    raise exception 'Only the workspace''s owner holds the owner role.';
  end if;
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.user_id <> old.user_id) then
    raise exception 'A membership changes role, never person or workspace.';
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_members_owner_rule on workspace_members;
create trigger workspace_members_owner_rule
  before insert or update or delete on workspace_members
  for each row execute function workspace_members_owner_rule();

-- The client-writable tables now ask for a role, not only membership. Reads are unchanged:
-- every role may read the workspace's evidence (see the audit for why auditors read replies).
drop policy if exists agents_insert on agents;
create policy agents_insert on agents for insert
  with check (has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));
drop policy if exists agents_update on agents;
create policy agents_update on agents for update
  using (has_workspace_role(workspace_id, array['owner', 'admin', 'operator']))
  with check (has_workspace_role(workspace_id, array['owner', 'admin', 'operator']));

drop policy if exists scenario_drafts_insert on scenario_drafts;
create policy scenario_drafts_insert on scenario_drafts for insert
  with check (has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'reviewer']));
-- Deciding a draft is an approval: the people who approve, not the people who draft.
drop policy if exists scenario_drafts_update on scenario_drafts;
create policy scenario_drafts_update on scenario_drafts for update
  using (has_workspace_role(workspace_id, array['owner', 'admin', 'reviewer']))
  with check (has_workspace_role(workspace_id, array['owner', 'admin', 'reviewer']));

drop policy if exists production_failures_insert on production_failures;
create policy production_failures_insert on production_failures for insert
  with check (has_workspace_role(workspace_id, array['owner', 'admin', 'operator', 'reviewer']));

-- ============================================================ audit events

-- One trail for who changed who may do what: memberships, roles, keys, settings, account
-- mode, memory. Append-only; a workspace's events leave with the workspace (erasure_log
-- records that it happened), a person's own events leave with their account.
create table if not exists audit_events (
  id              uuid primary key default gen_random_uuid(),
  -- Null for an event about a person rather than a workspace (account mode, memory).
  workspace_id    uuid references workspaces (id) on delete cascade,
  -- Plain ids, not foreign keys: the trail outlives the people in it, and an account that is
  -- deleted is pseudonymised, so the id stays meaningful and carries no personal data.
  actor_id        uuid,
  subject_user_id uuid,
  action          text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  detail          jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4000),
  created_at      timestamptz not null default now()
);
create index if not exists audit_events_workspace on audit_events (workspace_id, created_at desc);
create index if not exists audit_events_actor on audit_events (actor_id, created_at desc);

alter table audit_events enable row level security;
drop policy if exists audit_events_select on audit_events;
create policy audit_events_select on audit_events for select using (
  (workspace_id is not null and has_workspace_role(workspace_id, array['owner', 'admin', 'auditor']))
  or (workspace_id is null and actor_id = auth.uid())
);

create or replace function erasing_account()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('novera.erasing_account', true), '') = 'on';
$$;

create or replace function audit_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and (erasing_workspace() or erasing_account()) then
    return old;
  end if;
  raise exception 'The audit trail is append-only.';
end;
$$;
drop trigger if exists audit_events_append_only on audit_events;
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function audit_events_append_only();

-- ============================================================== invitations

create table if not exists workspace_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320 and position('@' in email) > 1),
  role         text not null check (role in ('admin', 'operator', 'reviewer', 'auditor')),
  -- SHA-256 of the link's token. The token itself is shown once, to the person who invited.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by   uuid not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz,
  revoked_by   uuid,
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);
create index if not exists workspace_invitations_ws on workspace_invitations (workspace_id, created_at desc);

alter table workspace_invitations enable row level security;
drop policy if exists workspace_invitations_select on workspace_invitations;
create policy workspace_invitations_select on workspace_invitations for select
  using (has_workspace_role(workspace_id, array['owner', 'admin']));

-- An invitation moves forward once: pending → accepted, or pending → revoked.
create or replace function workspace_invitations_forward_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if erasing_workspace() then return old; end if;
    raise exception 'An invitation is revoked, not deleted.';
  end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id or new.email <> old.email or new.role <> old.role
     or new.token_hash <> old.token_hash or new.invited_by <> old.invited_by or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at then
    raise exception 'An invitation''s terms are frozen.';
  end if;
  if old.accepted_at is not null or old.revoked_at is not null then
    raise exception 'An invitation that was accepted or revoked stays that way.';
  end if;
  return new;
end;
$$;
drop trigger if exists workspace_invitations_forward_only on workspace_invitations;
create trigger workspace_invitations_forward_only before update or delete on workspace_invitations
  for each row execute function workspace_invitations_forward_only();

-- Accepting runs as the invited person (auth.uid()), in one locked step: the email must be
-- the signed-in account's own, the invitation open and unexpired. An existing member keeps
-- their current role — an invitation never quietly changes someone's permissions.
create or replace function accept_invitation(p_token_hash text)
returns table (workspace_id uuid, role text, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv workspace_invitations;
  account_email text;
  existing text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into inv from workspace_invitations where token_hash = p_token_hash for update;
  if not found then raise exception 'invitation_not_found'; end if;
  if inv.revoked_at is not null then raise exception 'invitation_revoked'; end if;
  if inv.accepted_at is not null then raise exception 'invitation_used'; end if;
  if inv.expires_at <= now() then raise exception 'invitation_expired'; end if;
  select lower(email) into account_email from auth.users where id = uid;
  if account_email is distinct from inv.email then raise exception 'invitation_other_email'; end if;

  select m.role into existing from workspace_members m where m.workspace_id = inv.workspace_id and m.user_id = uid;
  if existing is null then
    insert into workspace_members (workspace_id, user_id, role) values (inv.workspace_id, uid, inv.role);
  end if;
  update workspace_invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  insert into audit_events (workspace_id, actor_id, subject_user_id, action, detail)
  values (inv.workspace_id, uid, uid, 'member.joined',
          jsonb_build_object('role', coalesce(existing, inv.role), 'invitation', inv.id, 'already_member', existing is not null));
  return query select inv.workspace_id, coalesce(existing, inv.role), existing is not null;
end;
$$;
revoke all on function accept_invitation(text) from public, anon;
grant execute on function accept_invitation(text) to authenticated;

-- Removing a member also revokes the API keys they created in that workspace: a key is how a
-- person's access outlives their membership otherwise (audit, 2026-10-02). One step, so the
-- membership and the keys cannot disagree. Called by the server after its permission check.
create or replace function remove_workspace_member(p_ws uuid, p_user uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n_keys integer;
  old_role text;
begin
  select role into old_role from workspace_members where workspace_id = p_ws and user_id = p_user for update;
  if old_role is null then raise exception 'not_a_member'; end if;
  delete from workspace_members where workspace_id = p_ws and user_id = p_user;
  update api_keys set revoked_at = now(), revoked_by = p_actor
   where workspace_id = p_ws and created_by = p_user and revoked_at is null;
  get diagnostics n_keys = row_count;
  insert into audit_events (workspace_id, actor_id, subject_user_id, action, detail)
  values (p_ws, p_actor, p_user, 'member.removed', jsonb_build_object('role', old_role, 'keys_revoked', n_keys));
  return n_keys;
end;
$$;
revoke all on function remove_workspace_member(uuid, uuid, uuid) from public, anon, authenticated;

-- =================================================================== profiles

-- A person's preferences — never credentials, keys, agent replies, customer data or legal
-- conclusions. Nothing here is read by grading, suites, policy evaluation or reports.
create table if not exists user_profiles (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  account_mode         text not null default 'personal' check (account_mode in ('personal', 'agency', 'enterprise')),
  display_name         text check (char_length(display_name) <= 80),
  job_title            text check (char_length(job_title) <= 80),
  company_name         text check (char_length(company_name) <= 120),
  locale               text not null default 'en-GB' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  timezone             text not null default 'UTC' check (char_length(timezone) <= 64),
  reduced_motion       text not null default 'system' check (reduced_motion in ('system', 'reduce', 'allow')),
  notifications        jsonb not null default '{}'::jsonb
                       check (jsonb_typeof(notifications) = 'object' and octet_length(notifications::text) <= 2000),
  onboarding_status    text not null default 'not_started' check (onboarding_status in ('not_started', 'skipped', 'completed')),
  primary_goal         text check (primary_goal in ('own_agent', 'client_delivery', 'governance')),
  channels             text[] not null default '{}' check (channels <@ array['web', 'voice', 'email']),
  default_workspace_id uuid references workspaces (id) on delete set null,
  default_agent_id     uuid references agents (id) on delete set null,
  preferred_suite_key  text check (char_length(preferred_suite_key) <= 64),
  report_format        text not null default 'link' check (report_format in ('link', 'pdf', 'markdown', 'json', 'junit', 'csv')),
  assistant_memory     boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function user_profiles_valid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone;
  end if;
  -- A default can only point where the person is a member, so a profile can never become a
  -- way to reach another workspace.
  if new.default_workspace_id is not null and not exists (
    select 1 from workspace_members m where m.workspace_id = new.default_workspace_id and m.user_id = new.user_id) then
    raise exception 'The default workspace must be one you belong to.';
  end if;
  if new.default_agent_id is not null and not exists (
    select 1 from agents a join workspace_members m on m.workspace_id = a.workspace_id
    where a.id = new.default_agent_id and m.user_id = new.user_id) then
    raise exception 'The default agent must be in a workspace you belong to.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists user_profiles_valid on user_profiles;
create trigger user_profiles_valid before insert or update on user_profiles
  for each row execute function user_profiles_valid();

alter table user_profiles enable row level security;
drop policy if exists user_profiles_select on user_profiles;
create policy user_profiles_select on user_profiles for select using (user_id = auth.uid());
drop policy if exists user_profiles_update on user_profiles;
create policy user_profiles_update on user_profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Created on first use, under the same per-user lock as the workspace (0029). An existing
-- account starts in the mode its data already describes: personal unless it belongs to
-- several workspaces or shares one. Never inferred from an email domain.
create or replace function ensure_profile()
returns user_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row user_profiles;
  n_ws integer;
  shared boolean;
  has_data boolean;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into row from user_profiles where user_id = uid;
  if found then return row; end if;
  perform pg_advisory_xact_lock(hashtextextended('ensure_profile:' || uid::text, 0));
  select * into row from user_profiles where user_id = uid;
  if found then return row; end if;

  select count(*) into n_ws from workspace_members where user_id = uid;
  select exists (select 1 from workspace_members m join workspace_members o on o.workspace_id = m.workspace_id and o.user_id <> m.user_id
                 where m.user_id = uid) into shared;
  select exists (select 1 from agents a join workspace_members m on m.workspace_id = a.workspace_id where m.user_id = uid) into has_data;

  insert into user_profiles (user_id, account_mode, onboarding_status)
  values (uid, case when n_ws > 1 or shared then 'agency' else 'personal' end,
          case when has_data then 'skipped' else 'not_started' end)
  returning * into row;
  return row;
end;
$$;
revoke all on function ensure_profile() from public, anon;
grant execute on function ensure_profile() to authenticated;

-- ======================================================= assistant history

create table if not exists assistant_threads (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists assistant_threads_user on assistant_threads (user_id, workspace_id, last_message_at desc);

create table if not exists assistant_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references assistant_threads (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (char_length(content) between 1 and 8000),
  citations  text[] not null default '{}',
  -- Who funded the answer and which model wrote it, as the answer said at the time.
  funded_by  text check (char_length(funded_by) <= 200),
  model      text check (char_length(model) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_thread on assistant_messages (thread_id, created_at);

-- A conversation is private to the person who had it, even from their teammates.
alter table assistant_threads enable row level security;
drop policy if exists assistant_threads_select on assistant_threads;
create policy assistant_threads_select on assistant_threads for select
  using (user_id = auth.uid() and is_workspace_member(workspace_id));
alter table assistant_messages enable row level security;
drop policy if exists assistant_messages_select on assistant_messages;
create policy assistant_messages_select on assistant_messages for select
  using (exists (select 1 from assistant_threads t where t.id = thread_id and t.user_id = auth.uid() and is_workspace_member(t.workspace_id)));

-- What was said stays as it was said; a thread is deleted whole.
create or replace function assistant_messages_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'A message is never edited; delete the conversation instead.';
end;
$$;
drop trigger if exists assistant_messages_frozen on assistant_messages;
create trigger assistant_messages_frozen before update on assistant_messages
  for each row execute function assistant_messages_frozen();

-- ========================================================== assistant memory

-- Explicit memory only: a person's action creates it, never the model's say-so. A fixed set
-- of keys, short values, nothing key-shaped. Read by Ask Novera alone — not by grading,
-- suites, schedules, policies or reports.
create table if not exists assistant_memory (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- Null: personal, follows the person everywhere. Set: shared with that workspace's members.
  workspace_id      uuid references workspaces (id) on delete cascade,
  key               text not null check (key in ('timezone', 'language', 'default_agent', 'default_suite', 'review_lens',
                                                 'report_style', 'explanation_length', 'terminology', 'note')),
  value             text not null check (char_length(btrim(value)) between 1 and 280),
  source            text not null check (source in ('settings', 'user_said', 'approved_candidate')),
  source_message_id uuid references assistant_messages (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  expires_at        timestamptz,
  -- Defence in depth behind the application's own refusal: nothing shaped like a key or token.
  check (value !~* '(sk-[a-z0-9_-]{16,}|nvk_[a-z0-9_-]{16,}|gsk_[a-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[a-z0-9]{20,}|bearer\s+[a-z0-9._-]{16,}|-----BEGIN)')
);
create unique index if not exists assistant_memory_one_value
  on assistant_memory (user_id, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  where key not in ('terminology', 'note');
create index if not exists assistant_memory_scope on assistant_memory (user_id, workspace_id);

alter table assistant_memory enable row level security;
drop policy if exists assistant_memory_select on assistant_memory;
create policy assistant_memory_select on assistant_memory for select using (
  (workspace_id is null and user_id = auth.uid())
  or (workspace_id is not null and is_workspace_member(workspace_id))
);

-- What the model suggested remembering. Shown with a Remember button; becomes memory only
-- through that click. Dismissed suggestions stay dismissed.
create table if not exists assistant_memory_candidates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  message_id  uuid not null references assistant_messages (id) on delete cascade,
  key         text not null check (key in ('timezone', 'language', 'default_agent', 'default_suite', 'review_lens',
                                           'report_style', 'explanation_length', 'terminology', 'note')),
  value       text not null check (char_length(btrim(value)) between 1 and 280),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  check (value !~* '(sk-[a-z0-9_-]{16,}|nvk_[a-z0-9_-]{16,}|gsk_[a-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[a-z0-9]{20,}|bearer\s+[a-z0-9._-]{16,}|-----BEGIN)')
);
alter table assistant_memory_candidates enable row level security;
drop policy if exists assistant_memory_candidates_select on assistant_memory_candidates;
create policy assistant_memory_candidates_select on assistant_memory_candidates for select
  using (user_id = auth.uid() and is_workspace_member(workspace_id));

-- ==================================================================== erasure

-- The new workspace-scoped tables, named, as every erasure path in this schema is. The rest is
-- 0042's function (the latest definition), copied exactly.
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

revoke execute on function erase_workspace(uuid, uuid) from public, anon, authenticated;

-- A person leaving Novera: their memberships, profile, conversations, memory and personal
-- events. Workspaces they own must be erased first (the application does that, after the
-- person confirms). The auth user is then pseudonymised by the application rather than
-- deleted: the evidence they produced stays attributed to an id with no personal data,
-- which is what an append-only record needs and what erasure of a person requires.
create or replace function erase_account(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owned integer;
  n_ws integer;
begin
  select count(*) into owned from workspaces where owner_id = target;
  if owned > 0 then raise exception 'owns_workspaces'; end if;
  perform set_config('novera.erasing_account', 'on', true);
  select count(*) into n_ws from workspace_members where user_id = target;
  update api_keys set revoked_at = now(), revoked_by = target where created_by = target and revoked_at is null;
  delete from workspace_members where user_id = target;
  delete from assistant_memory_candidates where user_id = target;
  delete from assistant_memory where user_id = target;
  delete from assistant_threads where user_id = target;
  delete from audit_events where workspace_id is null and actor_id = target;
  delete from user_profiles where user_id = target;
  perform set_config('novera.erasing_account', 'off', true);
  return jsonb_build_object('memberships_left', n_ws);
end;
$$;
revoke all on function erase_account(uuid) from public, anon, authenticated;

-- ================================================================= retention

-- A conversation nobody has touched for 180 days goes, with its messages and suggestions;
-- memory a person set an expiry on goes when it expires. Added to the existing daily pass
-- (0038), whose body is otherwise unchanged, so no new job has to be installed.
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
  perform set_config('novera.expiring_raw', 'off', true);

  delete from assistant_threads where last_message_at < now() - interval '180 days';
  get diagnostics n_threads = row_count;
  delete from assistant_memory where expires_at is not null and expires_at < now();
  get diagnostics n_memory = row_count;

  return jsonb_build_object('requests', n_requests, 'probes', n_probes, 'assistant_threads', n_threads, 'assistant_memory', n_memory);
end;
$$;
revoke execute on function expire_inbound_and_probes() from public, anon, authenticated;
