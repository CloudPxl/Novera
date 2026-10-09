# Backup and restore runbook

How Novera's data is backed up, how to get it back, and how to tell that what came back is
the evidence that was lost. A sealed report is only worth something if its run rows, its
hash chain and its append-only guarantees survive a restore, so the post-restore checks are
not optional.

**Never restore over the production project.** Every restore in this runbook goes into a
**new** Supabase project (or a scratch database), is checked, and only then is the
application pointed at it.

| | |
|---|---|
| Owner | David (operator). Claude prepares commands; David runs anything against production |
| Production database | Supabase, region eu-central-1 (Frankfurt) |
| RTO (time to restore service) | **TBD — placeholder.** Decide and write here. The local drill restored an 18 MB database in about 1 s; a real restore is dominated by creating the project, changing env vars and redeploying (estimate 1–2 h by hand) |
| RPO (data that may be lost) | **TBD — placeholder.** With daily backups only: up to 24 h. With PITR: minutes. With the manual dump below: since the last dump |
| Last reviewed | 2026-10-09 |

## 1. What is backed up today (verify on the dashboard)

Assumptions, to be **checked in Supabase → Project → Database → Backups** before they are relied on:

- Supabase takes **daily backups** of the database on paid plans (Pro keeps 7 days, as we
  understand the plan terms). On the **Free** plan, backups are limited or not downloadable —
  if the project is on Free, treat it as **having no backup** except the manual dump below.
- **Point-in-time recovery (PITR)** is a **paid add-on**. It is not assumed to be on.
- A Supabase restore from the dashboard restores **into the same project**, replacing the
  current data. That is the opposite of this runbook's rule; use it only when the current
  data is already lost, and download or dump first if anything is still readable.
- Supabase backups cover the database only — not Storage objects, not Edge Function
  secrets, and not anything outside Postgres. Novera keeps its evidence in Postgres; the
  `storage` schema is part of the dump below, the objects themselves are not.
- **Outside the database and needed to run a restored copy:** the Vercel environment
  variables — above all `NOVERA_ENCRYPTION_KEY`, without which every stored customer key and
  webhook secret in `secrets` is unreadable (by design). Keep a copy of the Vercel env set in
  a password manager. Also: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*` (they change
  with a new project), Resend, the model keys.

Record what the dashboard actually shows here:

| Item | Value | Checked on |
|---|---|---|
| Plan | _(Free / Pro / …)_ | |
| Daily backups visible and downloadable | _(yes / no)_ | |
| Retention | | |
| PITR | _(off / on, window)_ | |

## 2. Taking a manual backup

Do this before any risky change (a migration that rewrites data, a plan change) and on a
schedule that matches the RPO chosen above.

Use the **session pooler** (port **5432**), not the transaction pooler (6543): `pg_dump`
needs a session. Dashboard → Connect → Session pooler gives
`postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
The local `pg_dump` must be the server's major version or newer (17 today:
`brew install postgresql@17`).

**Preferred — Supabase CLI** (it knows which schemas Supabase manages):

```sh
export DB='postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
supabase db dump --db-url "$DB" -f roles.sql --role-only
supabase db dump --db-url "$DB" -f schema.sql
supabase db dump --db-url "$DB" -f data.sql --use-copy --data-only
```

**Alternative — plain pg_dump** (one custom-format file, schema and data):

```sh
pg_dump "$DB" -Fc --no-owner --no-privileges -n public -n auth -n storage -f novera-$(date -u +%F).dump
pg_dump "$DB" --schema-only -n public -f novera-schema-$(date -u +%F).sql   # readable copy
```

Store dumps encrypted (they contain customer data and sealed evidence: `age` / `gpg`, or an
encrypted disk), outside the Supabase account, and delete them on the same retention terms
as the data they hold (raw replies 30–365 days, the workspace's setting). Never commit one;
`.gitignore` does not know about them.

Also export, alongside: `select jobname, schedule, command, active from cron.job;` (the
scheduled jobs) and the list of Vault secret **names** (`select name from vault.secrets;`)
— not their values, which are encrypted with the project's own key and do not move.

## 3. Restoring into a new project

1. Create a **new** Supabase project in eu-central-1. Enable the extensions the source had:
   `pg_cron`, `pg_net`, `supabase_vault`, `pgcrypto`, `uuid-ossp` (Database → Extensions).
2. Restore (CLI dumps):
   ```sh
   export NEW='postgresql://postgres.<newref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
   psql "$NEW" --single-transaction -v ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' --file data.sql
   ```
   `session_replication_role = replica` stops triggers from firing while rows are loaded —
   the append-only, frozen-manifest and cross-workspace triggers would otherwise treat the
   restore as an edit. They are back in force as soon as the session ends (step 4 checks it).
   With the pg_dump file instead: `pg_restore -d "$NEW" --no-owner --no-privileges --single-transaction novera-<date>.dump`,
   then `npm run migrate -- --check` will show whether grants need re-applying.
3. **Scheduled jobs and Vault.** The clock's secret lives in Vault, encrypted with the old
   project's key, and does not survive the move. Re-create it and the job:
   `npm run schedules:clock -- install` (with `SUPABASE_DB_URL` pointing at the new project).
   The three daily jobs are created by migrations 0037/0038/0040 only when pg_cron was
   installed at the time; `npm run verify:cron` lists any that are missing and prints the
   `cron.schedule(...)` statement for each.
4. Run the checks in section 4 against the new project **before** pointing the app at it.
5. Point the app: Vercel → Settings → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. Keep
   `NOVERA_ENCRYPTION_KEY` **unchanged**. Redeploy. Then the Supabase dashboard settings that
   are not in the dump: Auth → URL configuration (Site URL, redirect allow list), SMTP,
   Google/GitHub providers, manual linking (`docs/setup/sign-in-and-email.md`).
6. Smoke test as a real user: sign in, open the dashboard, open one sealed report link, check
   `/api/health` answers `"database": true`.

## 4. Post-restore checks

All of them, in this order. Record the output.

```sh
# Structure and integrity of the restored copy (read-only; edits are tried and rolled back).
# SOURCE_DB_URL is optional: give it when the original is still readable.
RESTORED_DB_URL="$NEW" SOURCE_DB_URL="$DB" node --no-warnings scripts/restore-check.mts --allow-remote

npm run migrate -- --check     # ledger exposure, pending migrations, ledger vs files
npm run verify:db              # append-only, RLS, erasure paths
npm run verify:access          # what anon and authenticated can and cannot reach
npm run verify:tenancy         # cross-workspace references refused
npm run verify:cron            # the four scheduled jobs exist and run
npm run novera -- report verify <link>   # for a sample of sealed reports, through the app
```

(`.env.local` must point at the new project for the `npm run` lines.) `restore-check.mts`
recomputes **every** sealed report's SHA-256 from its stored payload; `novera report verify`
then checks a few through the deployed app end to end.

What `scripts/restore-check.mts` checks: row counts per table in `public`, `auth`, `storage`
and `vault` (against the source when given); RLS enabled on every public table; counts of
policies, triggers, functions, grants and Vault secrets; that a sealed report's hash cannot
be edited and run cases cannot be deleted; every report hash recomputes; the migration
ledger matches.

## 5. Rollback criteria — do not switch to the restored copy if

- any public table has RLS off, or the policy / trigger / grant counts differ from the source;
- any sealed report's hash does not recompute from its payload;
- an append-only table accepts an edit;
- `migrate -- --check` reports ledger drift or client access to the ledger;
- `verify:db`, `verify:access` or `verify:tenancy` fails;
- `secrets` rows cannot be opened with the current `NOVERA_ENCRYPTION_KEY` (a judge key test
  in Settings fails with "could not be opened").

If the switch has already happened and one of these appears: point the Vercel env vars back
at the previous project (if it still exists), redeploy, and keep the restored project for
investigation. Runs started on the restored copy in between are evidence too: export them
before dropping anything.

A missing cron job alone is not a rollback reason: install it (section 3, step 3) and re-run
`verify:cron`.

## 6. Restore drill (non-production) — checklist

Quarterly, and after any change to the schema's guarantees. On a local stack or a throwaway
project; never against production.

- [ ] Dump the source (section 2), note size and time.
- [ ] Create a scratch database or project; restore into it (section 3), note the time.
- [ ] Run `scripts/restore-check.mts` with `SOURCE_DB_URL` and `RESTORED_DB_URL`; all `ok`.
- [ ] Note any table whose count differs and why (a live source keeps changing after the dump).
- [ ] If a project: run `migrate -- --check`, `verify:db`, `verify:access`, `verify:tenancy` against it.
- [ ] Drop the scratch database / delete the project, and delete the dump file.
- [ ] Record the result below with the date, and update RTO/RPO if the numbers moved.

## Drills performed

### 2026-10-09 — local stack (no production involved)

Source: the local Supabase stack's database (`supabase_db_sb`, PostgreSQL 17.6, 18 MB,
59 migrations in its ledger). Run from the Phase 2 worktree by Claude.

1. `pg_dump -U supabase_admin -d postgres -Fc` inside the container: exit 0, 1.0 MB file
   (94 table-data entries: public 41, auth 27, storage 10, realtime 9 + 4, supabase_functions 2,
   vault 1). Copied to the session scratchpad (`ops/local-drill-2026-10-09.dump`), not to the repository.
   (A first dump as `postgres` also succeeded, but `postgres` is not a superuser on the
   Supabase image; the drill used `supabase_admin` so nothing was skipped.)
2. `createdb drill_restore`; `pg_restore -U supabase_admin -d drill_restore`: exit 0, **0
   errors**, about **1 second**. Extensions identical (pg_stat_statements, pgcrypto, plpgsql,
   supabase_vault, uuid-ossp). pg_cron is not installed on the local stack, so scheduled jobs
   were not part of this drill.
3. Integrity, restored copy against the source, immediately after the restore:
   - row counts: 79 tables, 3,638 rows, **0 differ**;
   - RLS enabled on **41/41** public tables, flags identical to the source;
   - policies 34 = 34, triggers on public tables 60 = 60, functions in public 57 = 57,
     grants to anon/authenticated/service_role 790 = 790, Vault secrets 0 = 0;
   - a sealed report's `content_hash` update refused ("Only revoked_at, revoked_by and
     expires_at may be changed…"), `delete from run_cases` refused ("Table run_cases is
     append-only") — in source and restored copy;
   - **9/9** sealed report hashes recompute from the stored payload, in both;
   - migration ledger: 59 entries, identical.
4. The same check rerun a few minutes later with the committed `scripts/restore-check.mts`
   showed `assistant_messages` 26 vs 24 and `model_operations` 13 vs 12: rows written to the
   live source *after* the dump, by other work on the same stack. That is what RPO means in
   practice, and the reason a drill compares immediately after the restore. The restored copy
   checked alone (no source): every check `ok`, exit 0.
5. `dropdb drill_restore`: exit 0; the container's temporary files removed.

Not covered by this drill: a Supabase-hosted restore, pg_cron jobs and Vault secrets moving
between projects, the app running against a restored copy, `verify:*` against it. Those are
the next drill, on a throwaway project.
