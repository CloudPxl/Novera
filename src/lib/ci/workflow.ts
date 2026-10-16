/**
 * The GitHub Actions workflow that gates a pull request on a Novera run — generated from one
 * function, so the copy on an agent's page, the documentation and the tests are the same file.
 *
 * Plain `curl` and `jq` (both on GitHub's hosted runners) and one first-party action to keep
 * the JUnit file; no third-party action. Every value GitHub takes from the pull request — the
 * branch name above all, which the author of a fork chooses — reaches the script through an
 * environment variable, never pasted into it, so it cannot become a command.
 *
 * The job exits with the published codes (0 pass · 1 fail · 2 incomplete · 3 configuration ·
 * 4 infrastructure), read from `GET /api/v1/ci/runs/<id>`; it never decides a code itself
 * from counts.
 */

export const WORKFLOW_PATH = ".github/workflows/novera-gate.yml";
export const DEFAULT_ORIGIN = "https://www.nover.space";

export interface WorkflowOptions {
  agentId: string;
  /** A suite key as `POST /api/v1/ci/trigger` reads it, pinned to a version: `eu-support-v5`. */
  suite: string;
  origin?: string;
  /** Branches whose pushes are gated too. Pull requests into any branch always are. */
  branches?: string[];
}

/** Characters that could end a YAML scalar or a shell word: kept out of what is pasted in. */
function plain(value: string, what: string): string {
  if (!/^[A-Za-z0-9._:/@-]+$/.test(value)) throw new Error(`The ${what} cannot be written into a workflow: ${JSON.stringify(value)}`);
  return value;
}

export function githubWorkflow(options: WorkflowOptions): string {
  const origin = plain((options.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, ""), "address");
  const agentId = plain(options.agentId, "agent id");
  const suite = plain(options.suite, "suite");
  const branches = (options.branches?.length ? options.branches : ["main"]).map((b) => plain(b, "branch"));

  return [
    "# Novera gate: tests the agent your pull request will ship against a pinned Novera suite.",
    "# The exit code is Novera's: 0 pass, 1 fail, 2 incomplete evidence, 3 configuration, 4 infrastructure.",
    "# A pass is evidence from one dated run of the suite, not a certification of the agent.",
    "name: Novera gate",
    "on:",
    "  pull_request:",
    "  push:",
    `    branches: [${branches.join(", ")}]`,
    "  workflow_dispatch:",
    "",
    "# A newer commit on the same branch replaces this job; Novera stops the run it superseded.",
    "concurrency:",
    "  group: novera-gate-${{ github.head_ref || github.ref_name }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  novera:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 45",
    "    env:",
    `      NOVERA_API: ${origin}/api/v1`,
    "      NOVERA_API_KEY: ${{ secrets.NOVERA_API_KEY }}",
    `      NOVERA_AGENT_ID: ${agentId}`,
    `      NOVERA_SUITE: ${suite}`,
    "      GIT_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
    "      GIT_BRANCH: ${{ github.head_ref || github.ref_name }}",
    "      PR_NUMBER: ${{ github.event.pull_request.number }}",
    "    steps:",
    "      - name: Start the run for this commit",
    "        run: |",
    "          if [ -z \"$NOVERA_API_KEY\" ]; then",
    "            # A pull request from a fork gets no secrets: there is no evidence to gate on.",
    "            echo \"NOVERA_API_KEY is not available to this workflow, so no run was started.\"",
    "            exit 3",
    "          fi",
    "          body=$(jq -n --arg agent \"$NOVERA_AGENT_ID\" --arg suite \"$NOVERA_SUITE\" \\",
    "            --arg sha \"$GIT_SHA\" --arg branch \"$GIT_BRANCH\" --arg pr \"$PR_NUMBER\" \\",
    "            '{agent_id: $agent, suite: $suite, git_commit_sha: $sha, git_branch: $branch}",
    "             + (if $pr == \"\" then {} else {pr_number: ($pr | tonumber)} end)')",
    "          # Safe to retry: the same commit answers with the run it already started.",
    "          status=$(curl -sS --retry 3 --retry-all-errors -o trigger.json -w '%{http_code}' \\",
    "            -X POST \"$NOVERA_API/ci/trigger\" \\",
    "            -H \"Authorization: Bearer $NOVERA_API_KEY\" \\",
    "            -H 'content-type: application/json' -d \"$body\") || exit 4",
    "          case \"$status\" in",
    "            200|202) ;;",
    "            400|401|403|404|409|429)",
    "              echo \"The run was not started ($status): $(jq -r '.error // \"no reason given\"' trigger.json)\"",
    "              exit 3 ;;",
    "            *) echo \"Novera answered $status.\"; exit 4 ;;",
    "          esac",
    "          jq -r 'if .deduplicated then \"This commit already has a run: \\(.run.id)\" else \"Started run \\(.run.id)\" end' trigger.json",
    "          echo \"NOVERA_RUN_ID=$(jq -r .run.id trigger.json)\" >> \"$GITHUB_ENV\"",
    "",
    "      - name: Drive the run until it is done",
    "        run: |",
    "          # Each call grades for about forty seconds. A call made while another is working",
    "          # does nothing, so calling again is harmless.",
    "          for i in $(seq 1 150); do",
    "            status=$(curl -sS --retry 3 --retry-all-errors -o step.json -w '%{http_code}' \\",
    "              -X POST \"$NOVERA_API/runs/$NOVERA_RUN_ID/execute\" \\",
    "              -H \"Authorization: Bearer $NOVERA_API_KEY\") || exit 4",
    "            case \"$status\" in 200|500) ;; *) echo \"Novera answered $status.\"; exit 4 ;; esac",
    "            [ \"$(jq -r .done step.json)\" = \"true\" ] && exit 0",
    "            sleep 5",
    "          done",
    "          echo \"The run did not finish in time, so there is no evidence to gate on.\"",
    "          exit 2",
    "",
    "      - name: Gate on the evidence",
    "        if: ${{ !cancelled() && env.NOVERA_RUN_ID != '' }}",
    "        run: |",
    "          curl -fsS --retry 3 --retry-all-errors \"$NOVERA_API/ci/runs/$NOVERA_RUN_ID\" \\",
    "            -H \"Authorization: Bearer $NOVERA_API_KEY\" -o gate.json || exit 4",
    "          curl -fsS --retry 3 --retry-all-errors \"$NOVERA_API/ci/runs/$NOVERA_RUN_ID?format=junit\" \\",
    "            -H \"Authorization: Bearer $NOVERA_API_KEY\" -o novera-junit.xml || echo \"The JUnit file could not be fetched.\"",
    "          code=$(jq -r '.ci_exit_code // \"none\"' gate.json)",
    "          {",
    "            echo \"### Novera: exit code $code\"",
    "            jq -r .ci_exit_reason gate.json",
    "            jq -r 'if .baseline_comparison then \"\\(.baseline_comparison.summary). Comparison: \\(.baseline_comparison.compare_url)\" else \"No earlier run of this suite to compare with.\" end' gate.json",
    "            jq -r 'if .report then \"Sealed report, checkable by anyone: \\(.report.verify_url)\" else \"No report was sealed.\" end' gate.json",
    "          } | tee -a \"$GITHUB_STEP_SUMMARY\"",
    "          if [ \"$code\" = \"none\" ]; then echo \"The run has not finished, so there is no evidence to gate on.\"; exit 2; fi",
    "          exit \"$code\"",
    "",
    "      # Any JUnit reporter can read this file; it carries the exit code, the suite digest and the seal.",
    "      - name: Keep the JUnit file",
    "        if: ${{ !cancelled() && env.NOVERA_RUN_ID != '' }}",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: novera-junit",
    "          path: novera-junit.xml",
    "          if-no-files-found: ignore",
    "",
  ].join("\n");
}
