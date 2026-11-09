# No-result states: what triggers them, how they are stored, how they are shown

Mapped 2026-11-09 from the code, for the no-result taxonomy (`src/lib/evidence/diagnostics.ts`). A
scenario's verdict is stored as `run_cases.status` ∈ `pass | fail | error` (check constraint, 0001);
everything below is a kind of `error` told apart by typed fields, or a run-level state. Nothing here
was renamed: sealed reports read these values, and a rename would break every document already sent.

| State | Triggered by | Stored as | Shown as (run page) | Category |
|---|---|---|---|---|
| Pass / fail | a rule, a read-back, or AI graders reaching a verdict | `status` pass/fail, `settled_by` deterministic/read_back/models | verdict chip | — (a result) |
| Disputed | two graders split, no third vendor settled it | `status` error, `judge_agreement` unresolved | "Graders could not agree" | Inconclusive |
| Grader rate-limited / timed out / unreadable / unreachable | router attempts all failed (`judge_attempts[].reason`) | `status` error, typed attempt reasons | "Graders rate-limited", etc. | Blocked on Novera's side, or by configuration on the workspace's own key |
| Data class refused | no grader approved for the reply's data class | `status` error, attempts `refused_data_class` | "No grader allowed this data" | Blocked by configuration |
| Agent timeout | no reply within the agent's timeout (≤ 30 s) | `status` error, runner sentence "did not answer within" | "Agent timed out" | Could not complete |
| Agent unreachable | connection failed; 408/429/502/503/504 | `status` error, "Request failed", "Agent returned HTTP 5xx" | "Agent unreachable" | Could not complete |
| Bad response | non-JSON, larger than 256 KB, other HTTP status, reply not at the response path | `status` error, runner sentence | "Reply was not JSON", "Reply too large", "Agent answered HTTP n", "Reply not where expected" | Result unavailable / Blocked by configuration (path) |
| Redirect | a 3xx from the agent | `status` error, "Agent returned HTTP 30x, a redirect to …" | "Agent answered HTTP 30x" | Blocked by configuration (as are 401 and 403: the address or the credential) |
| Not run | production guard, no `{{context}}`, no `{{history}}` slot | `status` error, `evidence_gap` + runner sentence | "Not run: …" | Not run |
| Address refused | private/loopback/metadata address at call time | `status` error, runner sentence | "Not sent: address refused" | Blocked by configuration |
| Read-back unavailable / action not verified | claimed action, read-back absent or unanswered | `status` error, `evidence_gap`, `observations.status` unavailable | "Read-back unavailable", "Action not verified" | Inconclusive |
| Cut by slice | the run's 42 s slice ended mid-scenario | `status` error, runner sentence | "Cut short by Novera" | Blocked on Novera's side |
| Unexecuted | planned scenario with no row (run aborted, halted, stopped) | no `run_cases` row; `runs.status` aborted with `error` | coverage "not run" count; run banner | (run-level: the run is never sealed) |
| Interrupted run | stopped by a person, idle 24 h, three transport failures or redirects in a row | `runs.status` aborted, `runs.error` fixed sentence | run banner; CI exit 3/4 | (run-level) |
| Withdrawn / expired report | workspace withdrawal (0053), link expiry | `reports.revoked_at`, `reports.expires_at` | report page refuses; `/verify` says so | Withdrawn or expired |
| Unclassified | an error matching none of the above | `status` error, stored text | "No verdict", stored error shown as is | Result unavailable, cause "not determined" |
