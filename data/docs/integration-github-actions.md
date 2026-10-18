---
title: Integration with GitHub Actions
published: true
---
This guide adds a workflow that tests your agent on every pull request and every push to `main`: it starts a Novera run for the commit, drives it to the end, and fails the job when the evidence fails or is incomplete. Set as a required status check, the job blocks the merge in the same cases. It uses only the public API described in [the API](/docs/api); the exit codes are the ones in [Reports in CI, and verifying a copy](/docs/cli-and-ci).

A pass here is evidence from one dated run of your suite, not a certification of your agent. The job tells you what that run found, nothing more.

## Before you start

1. Connect the agent in Novera and make sure it has a policy version ([Connecting an agent](/docs/connecting-an-agent)). The agent must already be serving the build you want to test: this workflow tests what is deployed at the agent's URL, it does not deploy anything. For a pull request, that usually means a preview deployment the agent's URL points at.
2. Create an API key under **Settings → API keys, MCP and webhooks** and tick **Can also start runs**. A key that can only read cannot start a run. Starting a run is counted exactly as the run button counts it — one of the trial's three runs, then one of your plan's or grant's runs — and grades on your workspace's own model key if it has one.
3. In your repository, add the key as a secret named `NOVERA_API_KEY`. Repository secrets are not available to a workflow triggered by a pull request from a fork; there the job stops with exit code `3` and says why, rather than passing without evidence.

## The workflow

Save this as `.github/workflows/novera-gate.yml`, with your agent's id in place of `your-agent-id` (`GET /api/v1/agents` lists the ids). Each agent's **Connection** tab in Novera offers the same file with its id already filled in.

```yaml
# Novera gate: tests the agent your pull request will ship against a pinned Novera suite.
# The exit code is Novera's: 0 pass, 1 fail, 2 incomplete evidence, 3 configuration, 4 infrastructure.
# A pass is evidence from one dated run of the suite, not a certification of the agent.
name: Novera gate
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

# A newer commit on the same branch replaces this job; Novera stops the run it superseded.
concurrency:
  group: novera-gate-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true

jobs:
  novera:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      NOVERA_API: https://www.nover.space/api/v1
      NOVERA_API_KEY: ${{ secrets.NOVERA_API_KEY }}
      NOVERA_AGENT_ID: your-agent-id
      NOVERA_SUITE: eu-support-v7
      GIT_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
      GIT_BRANCH: ${{ github.head_ref || github.ref_name }}
      PR_NUMBER: ${{ github.event.pull_request.number }}
    steps:
      - name: Start the run for this commit
        run: |
          if [ -z "$NOVERA_API_KEY" ]; then
            # A pull request from a fork gets no secrets: there is no evidence to gate on.
            echo "NOVERA_API_KEY is not available to this workflow, so no run was started."
            exit 3
          fi
          body=$(jq -n --arg agent "$NOVERA_AGENT_ID" --arg suite "$NOVERA_SUITE" \
            --arg sha "$GIT_SHA" --arg branch "$GIT_BRANCH" --arg pr "$PR_NUMBER" \
            '{agent_id: $agent, suite: $suite, git_commit_sha: $sha, git_branch: $branch}
             + (if $pr == "" then {} else {pr_number: ($pr | tonumber)} end)')
          # Safe to retry: the same commit answers with the run it already started.
          status=$(curl -sS --retry 3 --retry-all-errors -o trigger.json -w '%{http_code}' \
            -X POST "$NOVERA_API/ci/trigger" \
            -H "Authorization: Bearer $NOVERA_API_KEY" \
            -H 'content-type: application/json' -d "$body") || exit 4
          case "$status" in
            200|202) ;;
            400|401|403|404|409|429)
              echo "The run was not started ($status): $(jq -r '.error // "no reason given"' trigger.json)"
              exit 3 ;;
            *) echo "Novera answered $status."; exit 4 ;;
          esac
          jq -r 'if .deduplicated then "This commit already has a run: \(.run.id)" else "Started run \(.run.id)" end' trigger.json
          echo "NOVERA_RUN_ID=$(jq -r .run.id trigger.json)" >> "$GITHUB_ENV"

      - name: Drive the run until it is done
        run: |
          # Each call grades for about forty seconds. A call made while another is working
          # does nothing, so calling again is harmless.
          for i in $(seq 1 150); do
            status=$(curl -sS --retry 3 --retry-all-errors -o step.json -w '%{http_code}' \
              -X POST "$NOVERA_API/runs/$NOVERA_RUN_ID/execute" \
              -H "Authorization: Bearer $NOVERA_API_KEY") || exit 4
            case "$status" in 200|500) ;; *) echo "Novera answered $status."; exit 4 ;; esac
            [ "$(jq -r .done step.json)" = "true" ] && exit 0
            sleep 5
          done
          echo "The run did not finish in time, so there is no evidence to gate on."
          exit 2

      - name: Gate on the evidence
        if: ${{ !cancelled() && env.NOVERA_RUN_ID != '' }}
        run: |
          curl -fsS --retry 3 --retry-all-errors "$NOVERA_API/ci/runs/$NOVERA_RUN_ID" \
            -H "Authorization: Bearer $NOVERA_API_KEY" -o gate.json || exit 4
          curl -fsS --retry 3 --retry-all-errors "$NOVERA_API/ci/runs/$NOVERA_RUN_ID?format=junit" \
            -H "Authorization: Bearer $NOVERA_API_KEY" -o novera-junit.xml || echo "The JUnit file could not be fetched."
          code=$(jq -r '.ci_exit_code // "none"' gate.json)
          {
            echo "### Novera: exit code $code"
            jq -r .ci_exit_reason gate.json
            jq -r 'if .baseline_comparison then "\(.baseline_comparison.summary). Comparison: \(.baseline_comparison.compare_url)" else "No earlier run of this suite to compare with." end' gate.json
            jq -r 'if .report then "Sealed report, checkable by anyone: \(.report.verify_url)" else "No report was sealed." end' gate.json
          } | tee -a "$GITHUB_STEP_SUMMARY"
          if [ "$code" = "none" ]; then echo "The run has not finished, so there is no evidence to gate on."; exit 2; fi
          exit "$code"

      # Any JUnit reporter can read this file; it carries the exit code, the suite digest and the seal.
      - name: Keep the JUnit file
        if: ${{ !cancelled() && env.NOVERA_RUN_ID != '' }}
        uses: actions/upload-artifact@v4
        with:
          name: novera-junit
          path: novera-junit.xml
          if-no-files-found: ignore
```

`NOVERA_SUITE` pins the suite and its version, so every commit is tested against the same scenarios and two runs compare scenario by scenario. Change it to another suite key, such as `eu-gdpr-support-v1`, or to your workspace's own suite; `GET /api/v1/suites` lists them.

## What the job does

1. **Start the run for this commit** sends the commit, branch and pull request number to `POST /api/v1/ci/trigger`. The same commit sent again — a re-run job, a retried request — answers with the run it already started, so one commit never spends two runs. A newer commit on the same branch stops the unfinished run of the older one: aborted, never sealed, with the newer commit named as the reason.
2. **Drive the run until it is done** calls `POST /api/v1/runs/<id>/execute` until Novera says the run is done. Each call grades for about forty seconds.
3. **Gate on the evidence** reads `GET /api/v1/ci/runs/<id>` and exits with its `ci_exit_code`, after writing the reason, the comparison with the previous run and the public seal check to the job summary. The seal check (`/verify/<hash>`) shows no content; the report's own link, which does, is never printed.
4. **Keep the JUnit file** stores `novera-junit.xml` with the job. Any JUnit test reporter can read it; its properties carry the exit code, the suite digest, the seal and the comparison link.

## Exit codes

- `0` — every scenario ran and passed.
- `1` — at least one scenario failed. A failure outranks missing evidence.
- `2` — the evidence is incomplete: a scenario produced no result or did not run, the grade was withheld, a pass was given by one model only, the run was stopped or superseded before it finished, or it did not finish in time. Rerun the job; with your own model key, connect a second model.
- `3` — configuration: the key is missing (a pull request from a fork), wrong or lacks the permission to start runs, the agent or suite is wrong, the agent is archived or has no policy, the workspace has no run left, the fair-use limit was reached, or the run's report was withdrawn. The message names the reason.
- `4` — infrastructure: Novera could not be reached or answered with an error, or your agent could not be reached and the run was halted. An unreachable agent is never reported as a failure of the agent.

Any non-zero code fails the job. Add the job to your branch protection rules as a required status check and the merge is blocked when the evidence fails or is incomplete.

## The comparison with the previous run

The summary compares this run with the newest earlier completed run of the same agent on the same suite: "No previously passing scenario failed", or how many previously passing scenarios now fail, with a link to the side-by-side comparison. A verdict that moved while your agent's reply stayed identical is the graders moving, not your agent; it is listed separately and never counted as fixed or newly broken. The comparison is information for the reader: the job gates on the exit code alone.

## Notes

- The commit is recorded on the report as the release you declared, labelled as declared by you. Novera does not verify that the commit is what your agent is running.
- The key and the report's link are both credentials. The workflow keeps the key in the secret store and prints only the public seal check; do not add steps that echo either.
- The `novera` command line does the same in one step, but it is not yet published as an installable package, so this guide does not use it.
