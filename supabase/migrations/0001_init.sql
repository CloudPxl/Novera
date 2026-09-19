-- Novera core schema.
-- Evidence tables are append-only: clients get no update/delete policy, and triggers
-- block mutation even for the service role. A report is only worth what its evidence
-- is worth, so the immutability lives in the database rather than in application code.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tenancy

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references auth.users (id) on delete restrict,
  plan        text not null default 'trial' check (plan in ('trial', 'paid')),
  created_at  timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- security definer so the membership lookup does not re-enter the RLS policy that
-- calls it; stable so the planner can cache it within a statement.
create or replace function is_workspace_member(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------- agents

create table agents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  name          text not null,
  kind          text not null check (kind in ('http', 'model')),
  -- http: { url, method, headers, body_template, response_path }
  -- model: { provider, model, system_prompt }
  config        jsonb not null,
  -- the customer attests they own or are authorised to test this agent; stored with
  -- every run that uses it
  attested_by   uuid references auth.users (id),
  attested_at   timestamptz,
  attestation_text text,
  created_at    timestamptz not null default now()
);
create index on agents (workspace_id);

-- Encrypted material. No RLS policy at all: unreachable from any client token,
-- readable only by the server using the service role.
create table secrets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  scope         text not null check (scope in ('agent_auth', 'judge_key')),
  agent_id      uuid references agents (id) on delete cascade,
  provider      text,
  ciphertext    text not null,
  iv            text not null,
  tag           text not null,
  created_at    timestamptz not null default now()
);
create index on secrets (workspace_id, scope);

-- ---------------------------------------------------------------- policies

create table policies (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  agent_id      uuid not null references agents (id) on delete cascade,
  version       integer not null,
  body          text not null,
  derived_from  uuid references policies (id),
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  unique (agent_id, version)
);
create index on policies (workspace_id);

-- ---------------------------------------------------------------- suites

create table suites (
  id            uuid primary key default gen_random_uuid(),
  -- null workspace_id = a built-in suite shipped with the product
  workspace_id  uuid references workspaces (id) on delete cascade,
  key           text not null,
  version       integer not null,
  name          text not null,
  cases         jsonb not null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, key, version)
);

-- ---------------------------------------------------------------- evidence

create table probes (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  agent_id      uuid not null references agents (id) on delete cascade,
  request       jsonb not null,
  status_code   integer,
  response_body text,
  response_headers jsonb,
  latency_ms    integer,
  error         text,
  created_at    timestamptz not null default now()
);
create index on probes (agent_id, created_at desc);

create table runs (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces (id) on delete cascade,
  agent_id       uuid not null references agents (id) on delete restrict,
  policy_id      uuid not null references policies (id) on delete restrict,
  suite_id       uuid not null references suites (id) on delete restrict,
  baseline_run_id uuid references runs (id) on delete set null,
  status         text not null default 'queued'
                 check (status in ('queued', 'running', 'completed', 'aborted')),
  -- how the grading was paid for; a trial run is marked as such in its report
  judge_source   text check (judge_source in ('trial_free', 'workspace_key')),
  judge_provider text,
  judge_model    text,
  agent_model    text,
  attestation_text text,
  started_at     timestamptz,
  finished_at    timestamptz,
  error          text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now()
);
create index on runs (workspace_id, created_at desc);
create index on runs (agent_id, created_at desc);

create table run_cases (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  run_id        uuid not null references runs (id) on delete cascade,
  case_id       text not null,
  category      text not null,
  obligation    text not null,
  severity      text not null,
  input         text not null,
  expected      text not null,
  assertions    jsonb not null,
  response_text text,
  tool_activity jsonb,
  -- 'error' means the case did not produce a gradable result. It is never a pass and
  -- never a fail; coverage counts report it separately.
  status        text not null check (status in ('pass', 'fail', 'error')),
  rationale     text,
  latency_ms    integer,
  usage         jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  unique (run_id, case_id)
);
create index on run_cases (run_id);

create table diagnoses (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  run_case_id   uuid not null references run_cases (id) on delete cascade,
  analysis      text not null,
  quoted_old    text,
  proposed_new  text,
  risks         jsonb,
  status        text not null default 'proposed'
                check (status in ('proposed', 'approved', 'rejected')),
  resulting_policy_id uuid references policies (id) on delete set null,
  decided_by    uuid references auth.users (id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index on diagnoses (run_case_id);

create table reports (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces (id) on delete cascade,
  run_id        uuid not null references runs (id) on delete cascade,
  token         text not null unique,
  -- sha256 over the canonical serialisation of payload; printed on the report so a
  -- recipient can verify the document against the stored run
  content_hash  text not null,
  payload       jsonb not null,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index on reports (run_id);

-- ---------------------------------------------------------------- immutability

create or replace function refuse_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Table % is append-only: % is not permitted', tg_table_name, tg_op;
end;
$$;

create trigger policies_immutable    before update or delete on policies    for each row execute function refuse_mutation();
create trigger run_cases_immutable   before update or delete on run_cases   for each row execute function refuse_mutation();
create trigger probes_immutable      before update or delete on probes      for each row execute function refuse_mutation();

-- A report may only ever be revoked; its evidence and hash cannot be rewritten.
create or replace function reports_revoke_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Reports are append-only; revoke instead of deleting';
  end if;
  if new.payload is distinct from old.payload
     or new.content_hash is distinct from old.content_hash
     or new.run_id is distinct from old.run_id
     or new.token is distinct from old.token
     or new.created_at is distinct from old.created_at then
    raise exception 'Only revoked_at and expires_at may be changed on a report';
  end if;
  return new;
end;
$$;
create trigger reports_revoke_only before update or delete on reports for each row execute function reports_revoke_only();

-- ---------------------------------------------------------------- RLS

alter table workspaces        enable row level security;
alter table workspace_members enable row level security;
alter table agents            enable row level security;
alter table secrets           enable row level security;
alter table policies          enable row level security;
alter table suites            enable row level security;
alter table probes            enable row level security;
alter table runs              enable row level security;
alter table run_cases         enable row level security;
alter table diagnoses         enable row level security;
alter table reports           enable row level security;

-- secrets: intentionally no policy. Service role only.

create policy ws_select on workspaces for select using (is_workspace_member(id));
create policy ws_insert on workspaces for insert with check (owner_id = auth.uid());

create policy wsm_select on workspace_members for select using (is_workspace_member(workspace_id));

-- Built-in suites (workspace_id is null) are readable by any signed-in user.
create policy suites_select on suites for select
  using (workspace_id is null or is_workspace_member(workspace_id));

-- Read access for every workspace-scoped table.
create policy agents_select    on agents    for select using (is_workspace_member(workspace_id));
create policy policies_select  on policies  for select using (is_workspace_member(workspace_id));
create policy probes_select    on probes    for select using (is_workspace_member(workspace_id));
create policy runs_select      on runs      for select using (is_workspace_member(workspace_id));
create policy run_cases_select on run_cases for select using (is_workspace_member(workspace_id));
create policy diagnoses_select on diagnoses for select using (is_workspace_member(workspace_id));
create policy reports_select   on reports   for select using (is_workspace_member(workspace_id));

-- Writes go through the server, which owns validation, encryption and evidence
-- integrity. Clients get no insert/update/delete policy on evidence tables.
create policy agents_insert on agents for insert with check (is_workspace_member(workspace_id));
create policy agents_update on agents for update using (is_workspace_member(workspace_id));
