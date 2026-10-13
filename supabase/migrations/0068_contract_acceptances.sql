-- Contract acceptance ledger (legal build brief §20.1, 2026-10-13; DRAFT legal texts).
--
-- Before a paid plan starts, an owner or admin gives the organisation's business details, confirms
-- business purpose and authority, accepts the Terms, Privacy Notice, DPA, Acceptable Use Policy,
-- refund policy and AI testing scope, and — separately and expressly — the clauses Romanian Civil
-- Code art. 1203 says take effect only if expressly accepted in writing (limitation of liability,
-- suspension and termination, tacit renewal, governing law, jurisdiction, the report limits).
-- This table is the evidence: who, for which workspace and organisation, when, and the version
-- and SHA-256 of every text accepted. Checkout refuses a workspace without an acceptance of the
-- current versions (src/lib/billing/actions.ts).
--
-- Append-only, the service role included: an acceptance is never edited; a new version of the
-- terms needs a new row. Written only by the server after its `billing.manage` check — no client
-- write grant, no write policy. Read by the workspace's owner, admins and auditors.
--
-- No IP address is stored (Novera does not keep raw IPs; the privacy design has no basis for it
-- here). A VAT number is stored as declared and `vat_id_verified` stays false: Novera performs
-- no VIES validation, and the column exists so nothing can claim otherwise.
--
-- Leaves with its workspace through erase_workspace() (0062's body exactly, plus this table).
-- Whether acceptance records must outlive the workspace as evidence of the contract is a
-- question for counsel (docs/LEGAL-COUNSEL-QUESTIONS.md).

create table if not exists contract_acceptances (
  id                               uuid primary key default gen_random_uuid(),
  workspace_id                     uuid not null references workspaces (id),
  user_id                          uuid not null,
  source_surface                   text not null check (source_surface in ('checkout', 'order_form', 'admin', 'signup')),
  -- The Stripe mode of the deployment that recorded it: a sandbox acceptance is not a live one.
  livemode                         boolean not null,
  legal_entity_name_at_acceptance  text not null check (char_length(btrim(legal_entity_name_at_acceptance)) between 2 and 200),
  registered_address               text not null check (char_length(btrim(registered_address)) between 5 and 500),
  country                          text not null check (country ~ '^[A-Z]{2}$'),
  vat_id_declared                  text check (vat_id_declared is null or vat_id_declared ~ '^[A-Z]{2}[A-Z0-9]{2,13}$'),
  vat_id_verified                  boolean not null default false check (vat_id_verified = false),
  signer_name_at_acceptance        text not null check (char_length(btrim(signer_name_at_acceptance)) between 2 and 120),
  signer_title_at_acceptance       text not null check (char_length(btrim(signer_title_at_acceptance)) between 2 and 120),
  signer_authority_declared        boolean not null check (signer_authority_declared),
  b2b_purpose_declared             boolean not null check (b2b_purpose_declared),
  terms_accepted                   boolean not null check (terms_accepted),
  unusual_terms_expressly_accepted boolean not null check (unusual_terms_expressly_accepted),
  terms_version                    text not null,
  terms_sha256                     text not null check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  privacy_version                  text not null,
  dpa_version                      text not null,
  unusual_terms_version            text not null,
  unusual_terms_sha256             text not null check (unusual_terms_sha256 ~ '^[0-9a-f]{64}$'),
  billing_terms_version            text not null,
  -- Every document accepted: [{slug, title, version, sha256, status}].
  documents                        jsonb not null check (jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) > 0),
  -- Whether the accepted texts were counsel-approved or drafts (a sandbox accepts drafts; live does not).
  documents_status                 text not null check (documents_status in ('draft', 'approved')),
  plan_key                         text references billing_plans (key),
  billing_interval                 text not null default 'month' check (billing_interval in ('month')),
  locale                           text check (locale is null or char_length(locale) <= 35),
  user_agent                       text check (user_agent is null or char_length(user_agent) <= 300),
  consent_receipt_version          integer not null check (consent_receipt_version > 0),
  marketing_consent                boolean not null default false check (marketing_consent = false),
  accepted_at                      timestamptz not null default now(),
  created_at                       timestamptz not null default now()
);
create index if not exists contract_acceptances_workspace on contract_acceptances (workspace_id, accepted_at desc);

comment on table contract_acceptances is
  'Who accepted which terms for which organisation, when, with the version and SHA-256 of each text, including the separate express acceptance of unusual clauses (Civil Code art. 1203). Append-only; leaves with its workspace (0068).';
comment on column contract_acceptances.marketing_consent is
  'Novera asks for no marketing consent; the column is false so a later form must add one deliberately, by migration.';

drop trigger if exists contract_acceptances_append_only on contract_acceptances;
create trigger contract_acceptances_append_only before update or delete on contract_acceptances
  for each row execute function refuse_mutation();

-- A row names a member of its own workspace.
create or replace function contract_acceptance_member() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from workspace_members m where m.workspace_id = new.workspace_id and m.user_id = new.user_id and m.role in ('owner', 'admin')) then
    raise exception 'contract_acceptance_member: only an owner or admin of the workspace accepts its terms' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists contract_acceptance_member on contract_acceptances;
create trigger contract_acceptance_member before insert on contract_acceptances
  for each row execute function contract_acceptance_member();

alter table contract_acceptances enable row level security;
drop policy if exists contract_acceptances_select on contract_acceptances;
create policy contract_acceptances_select on contract_acceptances for select
  using (has_workspace_role(workspace_id, array['owner', 'admin', 'auditor']));
revoke insert, update, delete, truncate, references, trigger on contract_acceptances from anon, authenticated;
revoke all on contract_acceptances from anon;
revoke all on function contract_acceptance_member() from public, anon, authenticated;

-- Erasure: 0062's body exactly, plus contract_acceptances.
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
  -- 0061: export receipts. They name the workspace only; the files were never stored.
  delete from workspace_exports     where workspace_id = target;
  -- 0062: counts only, but they name the workspace.
  delete from product_events        where workspace_id = target;
  -- A profile pointing here loses the default, not the profile.
  update user_profiles set default_workspace_id = null where default_workspace_id = target;
  update user_profiles set default_agent_id = null
   where default_agent_id in (select id from agents where workspace_id = target);

  -- 0068: contract acceptances. They name the workspace and the person who accepted.
  delete from contract_acceptances         where workspace_id = target;
  -- 0060: billing. Subscriptions before the customer they name.
  delete from billing_events               where workspace_id = target;
  delete from billing_webhook_events       where workspace_id = target;
  delete from billing_subscription_history where workspace_id = target;
  delete from billing_subscriptions        where workspace_id = target;
  delete from billing_entitlement_grants   where workspace_id = target;
  delete from billing_customers            where workspace_id = target;


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
