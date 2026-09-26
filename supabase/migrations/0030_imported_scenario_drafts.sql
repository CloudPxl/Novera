-- Scenarios written for another tool (Promptfoo, DeepEval, LangSmith, Langfuse) enter
-- Novera the same way a drafted one does: as a draft a named person approves before it
-- can join a suite version. No second path into a suite, so no second set of rules.
--
-- What differs is where a draft came from. A policy draft quotes the passage it tests;
-- an imported one has no passage — it has a file, a tool, an item within that file and
-- the hashes that identify both. Each kind must carry its own proof and cannot borrow
-- the other's, which is what the check below says.
--
-- No new table, so no new erasure path: scenario_drafts is already deleted by
-- erase_workspace() (0022).

alter table scenario_drafts
  add column if not exists origin text not null default 'policy'
    check (origin in ('policy', 'import')),
  add column if not exists import_provenance jsonb;

alter table scenario_drafts alter column policy_id drop not null;
alter table scenario_drafts alter column source_quote drop not null;

alter table scenario_drafts drop constraint if exists scenario_drafts_origin_proof;
alter table scenario_drafts add constraint scenario_drafts_origin_proof check (
  (origin = 'policy' and policy_id is not null and source_quote is not null and import_provenance is null)
  or
  (origin = 'import' and policy_id is null and source_quote is null
     and import_provenance is not null
     and import_provenance ? 'source_tool'
     and import_provenance ? 'original_hash'
     and import_provenance ? 'item_hash')
);

comment on column scenario_drafts.origin is
  'policy: drafted by a model from a policy version, quoting the passage it tests. '
  'import: converted from another tool''s dataset; import_provenance says from where.';
comment on column scenario_drafts.import_provenance is
  'For an imported draft: source tool, file name, item id, SHA-256 of the file and of the '
  'item, transformation version, adjustments where Novera''s reading differs, assertions '
  'dropped for having no equivalent, and sanitisation status. Frozen at insert.';

-- The forward-only rule from 0022, with the two new columns frozen alongside the rest:
-- what a person approved has to be what they read, including where it came from.
create or replace function scenario_drafts_forward_only()
returns trigger language plpgsql as $$
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
  or new.created_at is distinct from old.created_at then
    raise exception 'A scenario draft is immutable; write a new draft instead of editing this one';
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'approved', 'rejected') then
    raise exception 'A draft becomes approved or rejected, not %', new.status;
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'included') then
    raise exception 'An approved draft cannot return to %', new.status;
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'A rejected draft cannot be revived; draft a new one';
  end if;
  if old.status = 'included' and new.status <> 'included' then
    raise exception 'A scenario already in a suite version cannot be withdrawn from it';
  end if;

  if new.status = 'approved' and (new.approved_by is null or new.approved_at is null) then
    raise exception 'An approval must record who made it and when';
  end if;
  if new.status = 'rejected' and (new.rejected_by is null or new.rejected_at is null
                                  or coalesce(btrim(new.rejection_reason), '') = '') then
    raise exception 'A rejection must record who made it, when, and why';
  end if;
  if new.status = 'included' and new.included_in_suite_id is null then
    raise exception 'A draft marked as included must name the suite version it entered';
  end if;

  return new;
end;
$$;
