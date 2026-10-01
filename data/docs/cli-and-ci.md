---
title: Reports in CI, and verifying a copy
published: true
---
A sealed report can be read by a machine as well as a person. Every report link has four downloads — Markdown, CSV, JSON and JUnit XML — and the JSON and JUnit files carry an exit code a CI pipeline can act on. Nothing here can change a report, start a run or publish anything.

## The exit codes

A pass/fail answer would hide the difference between an agent that failed and a run that did not finish, so there are five codes:

- `0` — every scenario in the suite ran and passed.
- `1` — at least one scenario failed. This outranks missing evidence: a failure is a finding whatever else is missing.
- `2` — the evidence is incomplete: a scenario produced no result, did not run, the grade was withheld, or a copy could not be verified.
- `3` — configuration or authorisation: the link is wrong, the report was withdrawn, or its link expired.
- `4` — infrastructure: the report could not be fetched.

Every code is read from the counts sealed in the report; nothing is recalculated.

## The downloads

Add `?format=` to the export address of a report, which is the report link with `/report/` replaced by `/api/reports/` and `/export` added: `https://www.nover.space/api/reports/<token>/export?format=json`. The formats are `md`, `csv`, `json` and `junit`.

The **JSON** file contains the sealed report exactly as it was hashed, its SHA-256 content hash, and a `ci` block with the exit code and the reason in words. The `ci` block is outside what the hash covers.

The **JUnit** file groups scenarios by obligation. A failed scenario is a JUnit failure; a scenario with no result is a JUnit error, never a failure and never a pass; a scenario that did not run is skipped. A sealed report names only the scenarios that failed or produced no result, so the scenarios that passed appear as one test case per obligation stating how many — Novera does not invent names for them. The JUnit file does not contain the report's full link, because a CI artifact is often visible to more people than the report should be; it identifies the report by its content hash.

## In GitHub Actions

Store the token (the last part of the report link) as a repository secret named `NOVERA_REPORT_TOKEN`, then add a step:

```yaml
- name: Novera report
  env:
    NOVERA_REPORT_TOKEN: ${{ secrets.NOVERA_REPORT_TOKEN }}
  run: |
    base="https://www.nover.space/api/reports/$NOVERA_REPORT_TOKEN/export"
    status=$(curl -sS -o novera.json -w '%{http_code}' "$base?format=json") || exit 4
    case "$status" in 200) ;; 400|404|410) echo "Report unavailable ($status)"; exit 3 ;; *) exit 4 ;; esac
    curl -fsS -o novera-junit.xml "$base?format=junit" || exit 4
    jq -r '.ci.reason' novera.json
    exit "$(jq -r '.ci.code' novera.json)"
```

Any test reporter that reads JUnit XML can display `novera-junit.xml`. Each report link is one sealed run: point the secret at a new link after each run.

## A release gate: run the suite on every deploy

With a workspace API key that can start runs (**Settings → API keys**, tick *Can also start runs*), a pipeline can run the suite itself and block the release on the result. Store the key as `NOVERA_API_KEY` and the agent's id as `NOVERA_AGENT_ID`:

```yaml
- name: Novera release gate
  env:
    NOVERA_API_KEY: ${{ secrets.NOVERA_API_KEY }}
    NOVERA_AGENT_ID: ${{ vars.NOVERA_AGENT_ID }}
  run: |
    api="https://www.nover.space/api/v1"
    auth="Authorization: Bearer $NOVERA_API_KEY"
    body="{\"agent_id\":\"$NOVERA_AGENT_ID\",\"release_id\":\"$GITHUB_SHA\"}"
    # One key per attempt of this job: a retried request returns the run it started, not a second one.
    key="github-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    run=$(curl -fsS --retry 3 --retry-all-errors -X POST "$api/runs" -H "$auth" -H "Idempotency-Key: $key" -H 'content-type: application/json' -d "$body" | jq -r .run.id) || exit 3
    for i in $(seq 1 120); do
      finished=$(curl -fsS -X POST "$api/runs/$run/execute" -H "$auth" | jq -r .done) || exit 4
      [ "$finished" = "true" ] && break
      sleep 5
    done
    url=$(curl -fsS "$api/runs/$run" -H "$auth" | jq -r '.run.report.url // empty') || exit 4
    [ -n "$url" ] || { echo "No report was sealed: the evidence is incomplete."; exit 2; }
    token="${url##*/report/}"
    curl -fsS -o novera.json "https://www.nover.space/api/reports/$token/export?format=json" || exit 4
    jq -r '.ci.reason' novera.json
    exit "$(jq -r '.ci.code' novera.json)"
```

The `Idempotency-Key` makes the retries safe: a request that timed out after the run started returns that same run instead of starting and paying for another. Re-running the job is a new attempt, so it starts a new run.

Exit code `2` — evidence incomplete — fails the job exactly as a failed scenario does: a release does not go out because nothing was found wrong in a run that did not finish. The commit is recorded on the report as the release you declared, labelled as declared by you. To be told about runs rather than waiting for them, add a webhook (**Settings → Webhooks**; see [the API](/docs/api)).

## Verifying a copy you were sent

The content hash printed on every report is the SHA-256 of the report's JSON payload in a fixed form: UTF-8, object keys sorted, no whitespace, array order kept. Anyone can recompute it from a JSON download without trusting Novera or whoever forwarded the file. If a single number in the payload was changed, the hash no longer matches.

A file whose hash matches is intact, but someone could have hashed their own edited payload. To know it is the report Novera sealed, compare its hash with the one on the report page at its link, or with a fresh JSON download from that link. A withdrawn report stops downloading the moment it is withdrawn.

## The command line

The `novera` command line wraps the same steps: `report status` prints the counts and exits with the code above, `report verify` checks a saved JSON file both ways, `report export` downloads any format, and `suite validate` checks a suite file before you import it. It is not yet published as an installable package; until it is, the steps above give the same result.
