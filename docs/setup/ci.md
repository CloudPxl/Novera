# Continuous integration

`.github/workflows/ci.yml` runs on every push to any branch and on every pull request.

**Branch protection is not active.** The workflow reports a result on each commit; nothing
stops a red commit from being merged or pushed to `main` until the settings below are
switched on in GitHub. Until then CI is advice, not a gate.

## What runs

| Job | Step | Command | What a failure means |
|---|---|---|---|
| Lint, types, tests, build | Install | `npm ci` | `package-lock.json` and `package.json` disagree |
| | Lint | `npm run lint` | ESLint (Next's config) |
| | Route types | `npx next typegen` | Generates `LayoutProps` and typed routes, which are not committed |
| | Typecheck | `npm run typecheck` · `npm run typecheck:6` | TypeScript 7's native checker, then TypeScript 6 (what Next and typescript-eslint use) |
| | Unit tests | `npm test` | The node test suite (`tests/*.test.ts`) |
| | Build | `npx next build` | Production build, with placeholder public values only |
| Migrations and secret scan | Migration files | `node scripts/check-migrations.mts --base <base>` | A name that is not `NNNN_snake_case.sql`, a number used twice, or a migration already on the base branch was modified, renamed or deleted |
| | Secret scan | `node scripts/scan-secrets.mts` | A tracked file holds a credential shape (provider keys, `nvk_`, `whsec_`, Stripe, Resend, Supabase service keys, private keys, database URLs with a password) |

Gaps in migration numbering, and a new migration numbered below the base's highest, are
**warnings**: parallel branches reserve numbers ahead of merging. `npm run migrate` applies
in filename order, so before applying, check that every lower-numbered migration from the
other branch is merged first.

The secret scan prints a masked excerpt, never the value. If it fires on a real key: remove
it from the branch, **rotate the key at its provider** (it is in the history and possibly a
fork already), then push. A fixture that has to look real carries `secret-scan: allow` on its
line.

## What deliberately does not run

The `verify:*` scripts, `migrate`, `seed:*`, `calibrate` and `demo:run` need a Supabase
database, a running app or model quota. They stay manual (see the commands table in
`CLAUDE.md`; `npm run verify:free` runs every free verifier against a local stack).

## Why it is safe on forks

- `permissions: contents: read` — the workflow's token can read the repository and nothing else.
- No secret is referenced. The build uses placeholder `NEXT_PUBLIC_*` values that point nowhere.
- Pull requests trigger `pull_request`, not `pull_request_target`, so a fork's code never runs
  with this repository's token or secrets.
- `actions/checkout` and `actions/setup-node` are pinned to a commit SHA (with the tag in a
  comment), so a moved tag cannot change what runs. `persist-credentials: false` keeps the
  token out of `.git/config`.
- One concurrency group per branch or pull request, cancelling the superseded run.

To update a pinned action: look up the new tag's commit (`git ls-remote https://github.com/actions/checkout refs/tags/v7.0.1`), check it is a commit and not an annotated tag object, and replace the SHA and the comment together.

## GitHub settings to switch on (David)

1. **Settings → Actions → General**
   1. Actions permissions: *Allow actions created by GitHub* plus the ones the workflow uses
      (only `actions/*` today) — or *Allow all actions* if you prefer, since they are SHA-pinned.
   2. Workflow permissions: **Read repository contents and packages permissions**.
   3. *Fork pull request workflows from outside collaborators*: **Require approval for all
      outside collaborators** (the repository is public).
2. **Settings → Branches → Add branch ruleset** (or classic protection) for `main`:
   1. Require a pull request before merging (0 approvals is fine for a one-person repo; it
      still forces CI to run on the change before it lands).
   2. **Require status checks to pass**, and add both checks:
      - `Lint, types, tests, build`
      - `Migrations and secret scan`

      They appear in the search box only after the workflow has run once on the repository.
   3. Require branches to be up to date before merging.
   4. Block force pushes; restrict deletions.
   5. Decide whether administrators may bypass. Bypass on means a direct push to `main`
      still works for you; off means every change goes through a pull request.
3. **Settings → Code security**: switch on *Secret scanning* and *Push protection* (free for
   public repositories). It complements `scan-secrets.mts` with GitHub's provider patterns
   and blocks the push itself.
4. Vercel keeps deploying on push as before; CI does not deploy anything. If you want Vercel
   to wait for CI, that is Vercel → Project → Settings → Git → *Ignored Build Step* or
   deployment checks, a separate decision.

Until steps 2.1–2.2 are done, this document's first paragraph is the accurate state.
