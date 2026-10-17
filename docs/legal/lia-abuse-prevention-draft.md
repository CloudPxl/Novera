# Legitimate interests assessment: abuse prevention (DRAFT)

**DRAFT — COUNSEL REVIEW REQUIRED. Not in force, not legal advice.** Written 2026-10-16 from the
code, because the founder's memo of 2026-10-16 (`docs/legal/2026-10-16-founder-memo.md`) proposes
GDPR Art. 6(1)(f) for salted IP hashing "backed by a written Legitimate Interests Assessment". It
answers nothing for counsel. It sets out the facts a three-part test needs (purpose, necessity,
balancing) so counsel can confirm, correct or replace it (counsel question 11).

## 1. The processing, as the code does it

| What | Where | Kept |
|---|---|---|
| A caller's network address, read from `x-forwarded-for` / `x-real-ip` on the request | `callerAddress()` in `src/lib/support/rate-limit.ts` | Never stored raw |
| Request counters keyed by a fingerprint: SHA-256 over a secret (`NOVERA_ENCRYPTION_KEY`) and the parts named, truncated to 40 hex characters. Parts include the address for the support form, the trial application form and sign-in, with the email typed (or alone, per address) | `fingerprint()` in `src/lib/support/throttle.ts`; `request_throttle` (0024) | About one day (0024 deletes windows older than a day) |
| The same fingerprint of the address (`["ip", address]`) stored on a support message or trial application as `source_ip_hash` | `src/lib/support/actions.ts`; 0009 | With the message: erased 90 days after the conversation last changed (0038) |

The fingerprint is **pseudonymous personal data**, not anonymous. Anyone holding the secret can
test a guessed address against it. It is not used to profile, track across sites or identify a
person, and nothing else is keyed to it.

## 2. Purpose test

- **Interest:** keep the public forms and sign-in available and stop them from being used to spend
  model quota, send email or write rows that cannot be deleted (the reasoning in
  `src/lib/support/rate-limit.ts`). That is network and information security in the sense of GDPR
  Recital 49, and fraud prevention in the sense of Recital 47.
- **Whose interest:** Novera's, and that of everyone else using the forms and sign-in.
- **Lawful and specific:** yes, in the draft's view. [COUNSEL TO CONFIRM.]

## 3. Necessity test

- A per-email counter alone can be bypassed by typing a new address each time. A per-address
  counter is what limits one script.
- Less intrusive means already applied: no raw address is stored; the hash is salted with a secret;
  counters live about a day; the stored fingerprint on a message goes with the message after 90 days.
- Not done: a CAPTCHA or third-party bot detection. Those would send visitors' data to another
  provider and, for most, set storage that needs consent.
- [COUNSEL TO CONFIRM THAT THE 90-DAY KEEPING OF `source_ip_hash` ON A SUPPORT MESSAGE IS NECESSARY,
  OR WHETHER IT SHOULD EXPIRE WITH THE ONE-DAY COUNTERS INSTEAD.]

## 4. Balancing test

- **Reasonable expectations:** a person submitting a public form or signing in expects basic abuse
  protection. The Privacy Notice draft says what is stored ("Abuse prevention").
- **Impact:** low in the draft's view. No decision about the person is made from it beyond "try
  again in N minutes". The refusal says how long to wait. Nothing is shared with a third party
  except the hosting and database providers that store every row.
- **Safeguards:** salted and truncated hash; short retention; no raw address; no linkage to an
  account beyond the email the person typed into the same request.
- **Objection (Art. 21):** a person can object through the privacy contact. The form cannot
  work without the counter, so the practical answer is to write by email instead. [COUNSEL TO
  CONFIRM.]

## 5. Draft conclusion

Art. 6(1)(f) appears available for this processing, with the safeguards above. **This is the draft
position from the founder's memo, awaiting counsel confirmation.** Review this assessment when the
processing changes: a new counter keyed to an address, a longer retention, or a third-party service.

## Not covered here

- The audit trail and run attestations (counsel question 8): a dual-purpose record, assessed
  separately once counsel confirms the roles.
- First-party product events (counsel question 22): keyed to a salted hash of the user id, not to
  an address, and kept 13 months (0062). Their legal basis is a separate question.
