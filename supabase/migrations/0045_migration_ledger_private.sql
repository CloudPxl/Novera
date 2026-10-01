-- The migration ledger is reachable only by the migration runner.
--
-- scripts/migrate.mts records each applied file in novera_migrations and skips any file
-- the ledger names. The runner created the table in `public` with plain `create table`,
-- where Supabase's default privileges grant every new table to anon, authenticated and
-- service_role, and it never enabled row-level security. Anyone holding the public anon
-- key could therefore read, add, change or delete ledger rows through the REST API — and
-- a row naming a migration that has not run makes the runner skip it in silence
-- (audit 2026-09-30, C1; reproduced against a local stack, never against production).
--
-- The runner connects as the table's owner, which row-level security does not restrict,
-- so closing the table to every API role changes nothing for it. No policy is created:
-- no API role has any business with this table. scripts/migrate.mts now creates the
-- ledger this way on a new database and refuses to run while a client role can reach it.
--
-- Forward only. Applied migration files are never edited; nothing here rewrites a row.

do $$
begin
  if to_regclass('public.novera_migrations') is null then
    return; -- Applied by hand to a database the runner has never touched: nothing to close.
  end if;
  alter table public.novera_migrations enable row level security;
  revoke all on table public.novera_migrations from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.novera_migrations from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.novera_migrations from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.novera_migrations from service_role;
  end if;
end;
$$;
