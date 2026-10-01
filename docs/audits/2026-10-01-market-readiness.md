# Market readiness — 2026-10-01

Written after the security and integrity pass on `security/remediation`, so it describes what is
*verified* on that branch, not what is planned. None of it is deployed yet.

## Demand: what is demonstrated, and what is not

**No customer demand is demonstrated.** Nobody has paid, no trial account belongs to a prospective buyer,
and no buyer conversation is recorded anywhere in the repository. Every feature below is labelled by where
its need comes from:

- **guarantee:** required for a claim Novera already makes to be true. Not optional, whoever asks.
- **inferred:** from the research documents and the buyer model in `docs/COMPETITION.md`, not from a buyer.
- **checklist:** a competitor has it. On its own this is never a reason to build.

The one step that would change this document most is not engineering: put the sample report and the
release-gate template in front of five agency delivery leads, and record what they ask for.

## Workflow 1 — an agency signs off a client's agent before release

| Step | Status on the branch | Evidence | Need |
|---|---|---|---|
| Connect the agent, attest authorisation | Works | `verify:tenancy`, `verify:api`; attestation stored with the run | guarantee |
| Run the suite from CI, retried safely | **Works** (new): `Idempotency-Key`, and the trial cap holds under concurrency | `verify:api`: 20 identical starts make 1 run; 20 rushed starts make exactly the allowance | guarantee |
| A slow, stalling or oversized agent cannot sink the run | **Works** (new) | stalled body, one of six stalling, and a 20 MB reply all complete; redaction is linear | guarantee |
| One release-gate answer, the same everywhere | **Works** for the webhook and the CLI (new); API consumers still derive it from counts | property test over every planned/recorded/band/status combination | guarantee |
| Get told when it finishes, once per receiver | **Works** (new): one sender per attempt, at-least-once, and missed announcements are recovered | `verify:webhooks` 29 | guarantee |
| Hand the client a report they can verify | Works: hash, chain, 18 old reports across 8 formats re-verified | `verify:access`; read-only production re-hash | guarantee |
| The client sees no raw conversations | Works: the report never holds replies; the API scrubs quoted personal data unless raw is asked for, and logs raw reads | `verify:api`, canary | guarantee |
| Release-gate templates for n8n and CI | Exist, but do not yet send `Idempotency-Key`, and the docs do not describe it | – | inferred; **needs approval** (customer-facing files) |

**Verdict:** the sign-off loop is sound once the branch is deployed. Two changes stand between it and a
self-serve agency: the template and docs updates, and decision G5 (whether a one-model verdict may pass a
release gate).

## Workflow 2 — an enterprise buyer's evidence, security and procurement review

| What they ask | Status | Gap |
|---|---|---|
| Evidence of what was tested, with limits | The report states scope and limitations, never certification | None |
| Integrity of the evidence | Append-only in the database; hash chain; the migration ledger is now closed (C1) | The ledger fix must reach production first |
| Tenant isolation | Enforced in the database even for the service role; verified | No public page states it (**needs approval**) |
| Data flows and sub-processors | `/docs/data-and-privacy` names providers and retention | No single data-flow page; it should say raw reads are logged (**needs approval**) |
| Network egress controls | Customer addresses are checked when the connection opens (R4) | Not validated on Vercel; say so |
| Access control for raw evidence | Logged per key and route | No separate `responses` scope (**proposal**) |
| Operational readiness | `verify:cron` and `verify:free` from an empty database | TLS to the database is verified only once `SUPABASE_DB_CA` is set |
| Recipient can check a reply later | Not possible: reports carry no reply fingerprints | Format-13 proposal |
| SSO/SAML, SCIM, DPA, pen test | None | checklist until a buyer asks |

**Verdict:** credible for a small agency's client, not yet for an enterprise security review. The gaps are
documentation and two scoped proposals, not architecture.

## What to do, in order

1. **Deploy the integrity fixes**, in the order of the gate: C1 alone first, then 0046–0051 with their
   code.
2. **Approve or edit the customer-facing wording**:
   - webhooks are at least once;
   - `Idempotency-Key`;
   - the 256 KB reply limit;
   - raw reads are logged;
   - the templates send a key.
3. **Decide G5:** may a one-model verdict pass a release gate? It changes what new reports mean, not old
   ones.
4. **Talk to five agencies** before building anything in P1 or P2 of `2026-10-01-market-gap.md`.
5. **Fund and calibrate a third grading vendor.** It is the measured fix for verdicts corroborated within
   one vendor.
