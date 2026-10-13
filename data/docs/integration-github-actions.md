---
title: Integration with GitHub Actions
published: true
---
This guide adds a workflow that starts a Novera run against your agent on every push to `main`, waits for it to finish, and fails the job when the evidence fails or is incomplete. Set as a required status check, the job blocks the merge in the same cases. It uses only the public API described in [the API](/docs/api); the exit codes are the ones in [Reports in CI, and verifying a copy](/docs/cli-and-ci).

A pass here is evidence from one dated run of your suite, not a certification of your agent. The job tells you what that run found, nothing more.

## Before you start

1. Connect the agent in Novera and make sure it has a policy version ([Connecting an agent](/docs/connecting-an-agent)). The agent must already be serving the build you want to test: this workflow tests what is deployed at the agent's URL, it does not deploy anything.
2. Create an API key under **Settings → API keys, MCP and webhooks** and tick **Can also start runs**. A key that can only read cannot start a run. Starting a run uses a trial run, or grades on your workspace's own model key, exactly as the run button does.
3. In your repository, add the key as a secret named `NOVERA_API_KEY`, and the agent's id as a variable named `NOVERA_AGENT_ID` (`GET /api/v1/agents` lists the ids). Repository secrets are not available to workflows triggered by a pull request from a fork, so the job below runs on pushes and on demand.

## The workflow

Save this as `.github/workflows/ai-gate.yml`:

```yaml
name: AI gate
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  novera:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      NOVERA_API_KEY: ${{ secrets.NOVERA_API_KEY }}
      NOVERA_AGENT_ID: ${{ vars.NOVERA_AGENT_ID }}
      NOVERA_API: https://www.nover.space/api/v1
    steps:
      - name: Start the run
        run: |
          # One Idempotency-Key per attempt of this job: a retried request returns the run
          # it already started instead of starting, and spending, a second one.
          key="github-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
          body=$(jq -n --arg agent "$NOVERA_AGENT_ID" --arg release "$GITHUB_SHA" \
            '{agent_id: $agent, release_id: $release}')
          status=$(curl -sS --retry 3 --retry-all-errors -o start.json -w '%{http_code}' \
            -X POST "$NOVERA_API/runs" \
            -H "Authorization: Bearer $NOVERA_API_KEY" \
            -H "Idempotency-Key: $key" \
            -H 'content-type: application/json' -d "$body") || exit 4
          case "$status" in
            200|201) ;;
            400|401|403|404|409|429)
              echo "The run was not started ($status): $(jq -r '.error // "no reason given"' start.json)"
              exit 3 ;;
            *) echo "Novera answered $status."; exit 4 ;;
          esac
          echo "NOVERA_RUN_ID=$(jq -r .run.id start.json)" >> "$GITHUB_ENV"

      - name: Advance the run until it is done
        run: |
          # Each call grades for about forty seconds and says whether the run is done.
          # A call made while another is still working does nothing, so this is harmless.
          for i in $(seq 1 150); do
            done_flag=$(curl -fsS -X POST "$NOVERA_API/runs/$NOVERA_RUN_ID/execute" \
              -H "Authorization: Bearer $NOVERA_API_KEY" | jq -r .done) || exit 4
            [ "$done_flag" = "true" ] && exit 0
            sleep 5
          done
          echo "The run did not finish in time, so there is no evidence to gate on."
          exit 2

      - name: Gate on the outcome
        run: |
          curl -fsS "$NOVERA_API/runs/$NOVERA_RUN_ID" \
            -H "Authorization: Bearer $NOVERA_API_KEY" -o run.json || exit 4
          outcome=$(jq -r .run.outcome run.json)
          {
            echo "### Novera: $outcome"
            jq -r '.run.outcome_reason' run.json
            jq -r '"Passed \(.run.counts.passed), failed \(.run.counts.failed), no result \(.run.counts.no_result)."' run.json
            jq -r 'if .run.report then "Sealed report: \(.run.report.url)" else "No report was sealed." end' run.json
          } | tee -a "$GITHUB_STEP_SUMMARY"
          case "$outcome" in
            pass) exit 0 ;;
            fail) exit 1 ;;
            incomplete) exit 2 ;;
            *) echo "Unexpected outcome: $outcome"; exit 4 ;;
          esac
```

## What the job reads

The gate reads three things from `GET /api/v1/runs/<id>`, all computed by Novera from the run's stored scenarios and its sealed report:

- `run.outcome` is `pass`, `fail` or `incomplete`. It is the same decision as the exit codes in [Reports in CI, and verifying a copy](/docs/cli-and-ci), read from the sealed report. A run that did not finish, or that sealed no report, is `incomplete`, never a pass.
- `run.outcome_reason` is the same decision in words.
- `run.counts` (`passed`, `failed`, `no_result`) and `run.report` (`url` and `content_hash`, or `null` when none was sealed) are printed for the reader. The job does not gate on the counts: a count cannot see a scenario that never ran, or a pass that only one model gave.

## Exit codes

- `0` — `pass`: every scenario ran and passed.
- `1` — `fail`: at least one scenario failed. A failure outranks missing evidence.
- `2` — `incomplete`: a scenario produced no result or did not run, the grade was withheld, the run did not finish, or a pass was given by one model only. Novera grades with two models so that no single model's reading decides; a pass the second model could not corroborate counts as incomplete evidence on reports in format 13 or later. Rerun the suite; with your own model key, connect a second model.
- `3` — The run was not started: the key is wrong or lacks the permission to start runs, the agent id is wrong, the agent is archived or has no policy, the workspace has no run left, or the fair-use limit was reached. The message names the reason.
- `4` — Infrastructure: Novera could not be reached, or answered with an error.

Any non-zero code fails the job. Add the job to your branch protection rules as a required status check and the merge is blocked when the evidence fails or is incomplete.

## Notes

- The commit is recorded on the report as the release you declared, labelled as declared by you. Novera does not verify that the commit is what your agent is running.
- Re-running the job in GitHub is a new attempt, so it starts a new run. A retried request inside one attempt returns the run it started (`"replayed": true`).
- Keep the key in the secret store. Do not put it in a command's arguments, where other processes and CI logs can see it.
- If you prefer to read the sealed report instead of the run, the report's JSON download carries a `ci` block with the code and the reason; the first example in [Reports in CI, and verifying a copy](/docs/cli-and-ci) shows that route.
- The `novera` command line does the same in one step, but it is not yet published as an installable package, so this guide does not use it.
