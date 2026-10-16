-- Suite extensions: an official suite, unchanged, with up to five of a workspace's own approved
-- scenarios run beside it (Block 5, src/lib/suites/extension.ts).
--
-- An extension is an ordinary workspace suite version — immutable from the moment it exists
-- (0056) — that names the official version it extends. What this migration adds is the reason a
-- reader can trust the name: the database, not the application, refuses an extension whose
-- leading scenarios are not the official suite's byte for byte and in order, that adds none or
-- more than five, or that adds a scenario no named person in the workspace approved (0022).
--
-- No new table, so no new erasure path: an extension is a `suites` row, erased with its
-- workspace by erase_workspace() as before; the column points only at a built-in suite, which is
-- never erased.

alter table suites add column if not exists extends_suite_id uuid references suites (id) on delete restrict;

comment on column suites.extends_suite_id is
  'The official (curated) suite version this workspace suite extends: its scenarios, byte for byte '
  'and in order, followed by at most five of the workspace''s approved scenarios. Null for every '
  'other suite. Checked on insert by suites_extension_checked; frozen by suites_immutable.';

create or replace function suites_extension_checked()
returns trigger language plpgsql as $$
declare
  base suites%rowtype;
  n_base integer;
  n_all integer;
  i integer;
  added jsonb;
begin
  if new.extends_suite_id is null then
    if new.provenance ? 'extends' then
      raise exception 'A suite that records what it extends must name that suite' using errcode = '23514';
    end if;
    return new;
  end if;

  select * into base from suites where id = new.extends_suite_id;
  if not found or base.workspace_id is not null or base.approval <> 'curated' then
    raise exception 'Only an official suite can be extended' using errcode = '42501';
  end if;
  if new.workspace_id is null or new.approval <> 'customer_approved' then
    raise exception 'An extension is a workspace suite of approved scenarios' using errcode = '23514';
  end if;

  n_base := jsonb_array_length(base.cases);
  n_all := jsonb_array_length(new.cases);
  if n_all - n_base < 1 or n_all - n_base > 5 then
    raise exception 'An extension adds between one and five scenarios to an official suite, not %', n_all - n_base
      using errcode = '23514';
  end if;

  for i in 0 .. n_base - 1 loop
    if new.cases -> i is distinct from base.cases -> i then
      raise exception 'An extension carries the official suite''s scenarios unchanged and in order; scenario % differs', i + 1
        using errcode = '23514';
    end if;
  end loop;

  for i in n_base .. n_all - 1 loop
    added := new.cases -> i;
    if not exists (
      select 1 from scenario_drafts d
       where d.workspace_id = new.workspace_id
         and d.status in ('approved', 'included')
         and d.approved_by is not null
         and d.scenario ->> 'id' = added ->> 'id'
         and btrim(d.scenario ->> 'input') = btrim(added ->> 'input')
         and btrim(d.scenario ->> 'expected_behavior') = btrim(added ->> 'expected_behavior')
    ) then
      raise exception 'Scenario % is not one a person in this workspace approved', added ->> 'id'
        using errcode = '42501';
    end if;
  end loop;

  if (new.provenance -> 'extends' ->> 'key') is distinct from base.key
  or (new.provenance -> 'extends' ->> 'version')::integer is distinct from base.version
  or (new.provenance -> 'extends' ->> 'base_scenarios')::integer is distinct from n_base then
    raise exception 'An extension''s record of what it extends must match the suite it names' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists suites_extension_checked on suites;
create trigger suites_extension_checked before insert on suites
  for each row execute function suites_extension_checked();
