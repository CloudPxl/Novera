/**
 * The public OpenAPI 3.1 description of `/api/v1`.
 *
 * Written by hand from the route handlers under `src/app/api/v1` and `src/lib/api/read.ts`;
 * `tests/discovery.test.ts` fails when a route file has no entry here or an entry has no route
 * file. It describes only what exists. There is no `GET /api/v1/reports/{id}`: a report is read
 * through the link a run carries, and its JSON and JUnit downloads.
 */

const UUID = { type: "string", format: "uuid" } as const;
const NULLABLE_STRING = { type: ["string", "null"] } as const;

const error = { $ref: "#/components/schemas/Error" };
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: error } },
});
const bearer = [{ bearerAuth: [] }];

const authErrors = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "429": { $ref: "#/components/responses/RateLimited" },
};

function scopeNote(scope: string): string {
  return `Needs a key with the \`${scope}\` scope.`;
}

export const OPENAPI_ORIGIN = "https://www.nover.space";

/** The paths documented here, as `/api/v1/...` route patterns. */
export function buildOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Novera API",
      version: "1.0.0",
      summary: "Read a workspace's agents, suites, runs and verdicts; start and advance runs; record a production failure.",
      description:
        "Novera runs a versioned scenario suite against an AI support agent and seals a dated, hash-sealed report. " +
        "Novera is evidence of testing, not a legal certification. " +
        "Every call is made with a workspace API key (`Authorization: Bearer nvk_…`) and sees only that workspace. " +
        "A key reads by default; starting runs, reading the agent's replies, and recording failures or testing a connection need the `run`, `responses` and `write` scopes, chosen when the key is created. " +
        "A fifth scope, `probe`, is for single-scenario checks; like every scope beyond `read`, it is granted only together with `read`. " +
        "For a CI gate, `POST /api/v1/ci/trigger` starts one run per commit and `GET /api/v1/ci/runs/{id}` answers with the exit code (0 pass, 1 fail, 2 incomplete, 3 configuration, 4 infrastructure), in JSON or JUnit. " +
        "There is no endpoint that reads a report by id: a finished run carries `report.url` and `report.content_hash`, and the report's JSON and JUnit downloads carry the CI exit code. " +
        "No key can approve a draft, change a policy, or publish or revoke a report. Every answer, refusals included, is JSON. " +
        "Documentation: https://www.nover.space/docs/api",
    },
    servers: [{ url: OPENAPI_ORIGIN }],
    security: bearer,
    tags: [
      { name: "Read", description: "Needs the `read` scope." },
      { name: "Runs", description: "Starting and advancing runs needs the `run` scope." },
      { name: "Regressions", description: "Needs the `write` scope." },
      { name: "CI", description: "Gating a pipeline on a run: triggering needs the `run` scope, reading the result `read`." },
      { name: "Agents", description: "Testing a connection before saving it. Needs the `write` scope." },
      { name: "Checks", description: "Single-scenario checks: one scenario against one agent, never a run. Needs the `probe` scope." },
    ],
    paths: {
      "/api/v1/agents": {
        get: {
          operationId: "listAgents",
          tags: ["Read"],
          summary: "List the workspace's agents",
          description: `${scopeNote("read")} Policy text is never returned. Archived agents are left out unless asked for.`,
          security: bearer,
          parameters: [
            {
              name: "archived", in: "query", required: false,
              description: "Whether to include archived agents. Default `exclude`.",
              schema: { type: "string", enum: ["exclude", "include", "only"], default: "exclude" },
            },
          ],
          responses: {
            "200": {
              description: "The agents, oldest first.",
              content: { "application/json": { schema: { type: "object", required: ["agents"], properties: { agents: { type: "array", items: { $ref: "#/components/schemas/Agent" } } } } } },
            },
            "400": errorResponse("`archived` is not exclude, include or only."),
            "403": { $ref: "#/components/responses/MissingScope" },
            ...authErrors,
          },
        },
      },
      "/api/v1/agents/test-connection": {
        post: {
          operationId: "testAgentConnection",
          tags: ["Agents"],
          summary: "Test an agent connection without saving it",
          description:
            `${scopeNote("write")} Sends one diagnostic message — "Hello, this is a connection check from Novera. Please reply briefly." — to a connection described in the body, or to a saved agent (\`agent_id\`, on its stored credential), and says what came back. ` +
            "The same function as \"Test connection\" on the connect and edit forms: the same request template, header and public-address check a run uses, a 10-second deadline, and nothing stored — no agent, no probe receipt. " +
            "A test result is always 200 with a stable `outcome`: `ok`, `timeout`, `unreachable`, `refused_address`, `unauthorized` (HTTP 401 or 403), `http_error`, `redirect`, `too_large`, `not_json` or `no_reply_at_path` (with `top_level_keys`, names only, and `suggested_path` when one can be found). " +
            "20 tests per workspace in ten minutes, shared with the forms.",
          security: bearer,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      required: ["agent_id"],
                      properties: { agent_id: { ...UUID, description: "A saved agent from `GET /api/v1/agents`. Sent alone." } },
                    },
                    {
                      type: "object",
                      required: ["url"],
                      properties: {
                        url: { type: "string", format: "uri", description: "The agent's endpoint, http or https, on a public address." },
                        body_template: { description: "A JSON object (or that object as a string) carrying `{{input}}`. Default `{\"message\":\"{{input}}\"}`.", oneOf: [{ type: "object" }, { type: "string" }] },
                        response_path: { type: "string", default: "reply", description: "Dot path to the reply text, such as `choices.0.message.content`." },
                        tool_activity_path: { type: "string" },
                        timeout_seconds: { type: "integer", minimum: 2, maximum: 30, description: "Checked as on saving; a test always waits at most 10 seconds." },
                        auth_header_name: { type: "string", examples: ["authorization"] },
                        auth_value: { type: "string", description: "Used for this one request and never stored or returned." },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "The message was sent, or refused by the public-address check; `outcome` says which and what came back.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ConnectionTest" } } },
            },
            "400": errorResponse("The body is not a JSON object, or a field is missing or malformed (`code`: `invalid_request`)."),
            "403": { $ref: "#/components/responses/MissingScope" },
            "404": errorResponse("No such agent in this workspace (`code`: `not_found`)."),
            "409": errorResponse("The agent is archived (`archived`) or is not an HTTP agent (`not_http`)."),
            "429": {
              description: "20 tests by this workspace in the last ten minutes (`code`: `rate_limited`), or more than 120 requests a minute for this key.",
              headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
              content: { "application/json": { schema: error } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "503": errorResponse("The tests in the last ten minutes could not be counted, so nothing was sent (`code`: `limit_unavailable`)."),
          },
        },
      },
      "/api/v1/suites": {
        get: {
          operationId: "listSuites",
          tags: ["Read"],
          summary: "List the suite versions the workspace can run",
          description: `${scopeNote("read")} Built-in suites and the workspace's own. Exploratory Suite Builder scans are not listed.`,
          security: bearer,
          responses: {
            "200": {
              description: "Suite versions, by key then newest version first.",
              content: { "application/json": { schema: { type: "object", required: ["suites"], properties: { suites: { type: "array", items: { $ref: "#/components/schemas/Suite" } } } } } },
            },
            "403": { $ref: "#/components/responses/MissingScope" },
            ...authErrors,
          },
        },
      },
      "/api/v1/runs": {
        get: {
          operationId: "listRuns",
          tags: ["Read"],
          summary: "List recent runs, newest first",
          description: `${scopeNote("read")} Counts are computed from the run's stored scenarios. Gate on \`outcome\`, not on the counts: counts cannot see a scenario that never ran, or a pass only one model gave.`,
          security: bearer,
          parameters: [
            { name: "agent", in: "query", required: false, description: "Only this agent's runs.", schema: UUID },
            { name: "limit", in: "query", required: false, description: "How many runs, 1 to 100.", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          ],
          responses: {
            "200": {
              description: "Recent runs.",
              content: { "application/json": { schema: { type: "object", required: ["runs"], properties: { runs: { type: "array", items: { $ref: "#/components/schemas/RunSummary" } } } } } },
            },
            "400": errorResponse("`agent` is not an agent id, or `limit` is not a whole number from 1 to 100."),
            "403": { $ref: "#/components/responses/MissingScope" },
            ...authErrors,
          },
        },
        post: {
          operationId: "startRun",
          tags: ["Runs"],
          summary: "Start a run",
          description:
            `${scopeNote("run")} The same checks as the run button: the agent needs a policy version, the workspace needs a run left or its own model key, and the authorisation recorded for the agent is attached. ` +
            "The run is queued; call `POST /api/v1/runs/{id}/execute` until `done` is true. " +
            "Send an `Idempotency-Key` and a retried request never starts a second run.",
          security: bearer,
          parameters: [
            {
              name: "Idempotency-Key", in: "header", required: false,
              description: "1 to 200 visible ASCII characters, new for each run you mean to start. The same key with the same body within 24 hours answers 200 with the run it already started and `replayed: true`. The same key with a different body, or while the first request is still starting its run, answers 409.",
              schema: { type: "string", minLength: 1, maxLength: 200, pattern: "^[\\x21-\\x7E]{1,200}$" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["agent_id"],
                  properties: {
                    agent_id: { ...UUID, description: "An agent from `GET /api/v1/agents`." },
                    suite_id: { ...UUID, description: "A suite from `GET /api/v1/suites`. The newest built-in version when omitted." },
                    release_id: { type: "string", maxLength: 100, description: "What you are testing, as declared by you; the report shows it as declared." },
                    knowledge_base_revision: { type: "string", maxLength: 100, description: "As declared by you; the report shows it as declared." },
                    locale: { type: "string", enum: ["en", "de", "fr", "ro"], default: "en", description: "The language the scenarios are sent in. Only scenarios with a variant in that language are translated; the report says how many. Refused for a suite with no variant in it." },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "An earlier request with this Idempotency-Key already started this run; nothing new started.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/StartedRun" } } },
            },
            "201": {
              description: "The run was queued.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/StartedRun" } } },
            },
            "400": errorResponse("The body is not JSON, `agent_id`, `suite_id`, `release_id` or `knowledge_base_revision` is invalid, or the Idempotency-Key is malformed."),
            "403": { $ref: "#/components/responses/MissingScope" },
            "409": errorResponse("The run could not start (the error says why; `code` names the blocker when there is one), or the Idempotency-Key conflicts with a different request or one still starting."),
            "429": {
              description: "Too many requests for this key, or fair use: too many runs in progress or in 30 days (`code` is `concurrency` or `fair_use`).",
              headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
              content: { "application/json": { schema: error } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "500": errorResponse("The run could not be started."),
          },
        },
      },
      "/api/v1/runs/{id}": {
        get: {
          operationId: "getRun",
          tags: ["Read"],
          summary: "Read one run and every scenario in it",
          description:
            `${scopeNote("read")} A run in another workspace and an id that is not a run both answer 404. ` +
            "Without `include=responses`, personal data a grader quoted in a reason is a placeholder, as in a report. " +
            "`include=responses` needs a key that also has the `responses` scope; each such read is recorded.",
          security: bearer,
          parameters: [
            { name: "id", in: "path", required: true, schema: UUID },
            {
              name: "include", in: "query", required: false,
              description: "`responses` adds `input`, `response` and `transcript` to each scenario, exactly as stored. Requires the `responses` scope.",
              schema: { type: "string", enum: ["responses"] },
            },
          ],
          responses: {
            "200": {
              description: "The run.",
              content: { "application/json": { schema: { type: "object", required: ["run"], properties: { run: { $ref: "#/components/schemas/RunDetail" } } } } },
            },
            "403": errorResponse("The key lacks the `read` scope, or `include=responses` was asked for without the `responses` scope."),
            "404": errorResponse("No such run in this workspace."),
            ...authErrors,
          },
        },
      },
      "/api/v1/runs/{id}/execute": {
        post: {
          operationId: "advanceRun",
          tags: ["Runs"],
          summary: "Advance a run by one slice",
          description:
            `${scopeNote("run")} Grades for about forty seconds and says whether the run is done. Call it until \`done\` is true. ` +
            "A call made while another is still working answers `started: false` and does nothing, so calling too often is harmless.",
          security: bearer,
          parameters: [{ name: "id", in: "path", required: true, schema: UUID }],
          responses: {
            "200": {
              description: "The state after this call.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Advance" } } },
            },
            "403": { $ref: "#/components/responses/MissingScope" },
            "404": errorResponse("No such run in this workspace."),
            "500": errorResponse("The run stopped with an error. GET the run for details."),
            ...authErrors,
          },
        },
      },
      "/api/v1/ci/trigger": {
        post: {
          operationId: "triggerCiRun",
          tags: ["CI"],
          summary: "Start a run for a commit",
          description:
            `${scopeNote("run")} Starts the run through the same function as \`POST /api/v1/runs\`, with the same checks and refusals. ` +
            "The same commit, agent and suite again answers 200 with the run it already started (`deduplicated: true`), whatever its state, unless that run was aborted: an aborted run seals nothing, so the commit gets a new run. " +
            "With `cancel_superseded` (default true), unfinished runs that other commits on the same branch started through this endpoint for the same agent are stopped: aborted, never sealed, their graded scenarios kept. " +
            "The commit is stated on the report as the release you declared, unless you send `release_id`. " +
            "Field names are also accepted in camelCase (`agentId`, `suiteSlug`, `gitCommitSha`, `gitBranch`, `prNumber`, `cancelSuperseded`); answers are snake_case.",
          security: bearer,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["agent_id"],
                  properties: {
                    agent_id: { ...UUID, description: "An agent from `GET /api/v1/agents`." },
                    suite: { type: "string", description: "A suite key, pinned (`eu-support-v5`) or newest (`eu-support`); the workspace's own suite first, then a built-in one. Send this or `suite_id`, not both." },
                    suite_id: { ...UUID, description: "A suite from `GET /api/v1/suites`. The newest built-in eu-support when neither is sent." },
                    git_commit_sha: { type: "string", pattern: "^[0-9a-fA-F]{7,64}$", description: "The commit under test. Without it, every trigger starts a new run." },
                    git_branch: { type: "string", maxLength: 255, description: "The branch; needed for `cancel_superseded`." },
                    pr_number: { type: "integer", minimum: 1 },
                    cancel_superseded: { type: "boolean", default: true },
                    release_id: { type: "string", maxLength: 100, description: "What the report states as declared. The commit when omitted." },
                    knowledge_base_revision: { type: "string", maxLength: 100 },
                    locale: { type: "string", enum: ["en", "de", "fr", "ro"], default: "en", description: "The language (part of what \"the same commit\" means: one commit may run once per language) the scenarios are sent in. Only scenarios with a variant in that language are translated; the report says how many. Refused for a suite with no variant in it." },
                    include_extensions: { type: "boolean", default: false, description: "Run the workspace's newest extension of the named official suite: its scenarios byte for byte plus at most five the workspace approved. 404 when the workspace has none." },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "This commit already has a run on this agent and suite; nothing new started.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CiTriggered" } } },
            },
            "202": {
              description: "The run was queued. Drive it with `POST /api/v1/runs/{id}/execute` until `done` is true, then read `poll_url`.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CiTriggered" } } },
            },
            "400": errorResponse("The body is not a JSON object, or a field is malformed."),
            "403": { $ref: "#/components/responses/MissingScope" },
            "404": errorResponse("No such agent or suite in this workspace."),
            "409": errorResponse("The run could not start (the error says why; `code` names the blocker when there is one), or another request is starting this commit's run right now."),
            "429": {
              description: "Too many requests for this key, or fair use: too many runs in progress or in 30 days (`code` is `concurrency` or `fair_use`).",
              headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
              content: { "application/json": { schema: error } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "500": errorResponse("The run could not be started."),
          },
        },
      },
      "/api/v1/ci/runs/{id}": {
        get: {
          operationId: "getCiRun",
          tags: ["CI"],
          summary: "Read a run as a CI gate",
          description:
            `${scopeNote("read")} The exit code is the sealed report's own (0 pass, 1 fail, 2 incomplete), from the same decision as the report's JSON and JUnit downloads and the CLI. ` +
            "Without a sealed report: null while the run is queued or running; 4 when the run was halted because the agent could not be reached; 2 when it was aborted for any other reason or sealed nothing; 3 when its report was withdrawn. " +
            "`baseline_comparison` compares with the newest earlier completed run of the same agent on the same suite key; a verdict that moved on an identical reply is listed under `graders_moved` and never counted as fixed or newly broken. " +
            "`?format=junit`, or an `Accept` header naming XML, answers JUnit XML with the code, the suite digest, the seal and the comparison link as properties.",
          security: bearer,
          parameters: [
            { name: "id", in: "path", required: true, schema: UUID },
            { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "junit"], default: "json" } },
          ],
          responses: {
            "200": {
              description: "The run's gate decision, as JSON or JUnit XML.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/CiRun" } },
                "application/xml": { schema: { type: "string", description: "A JUnit document. Without a sealed report it has one test case: skipped while the run is unfinished, an error otherwise." } },
              },
            },
            "400": errorResponse("`format` is not json or junit."),
            "403": { $ref: "#/components/responses/MissingScope" },
            "404": errorResponse("No such run in this workspace."),
            ...authErrors,
          },
        },
      },
      "/api/v1/probes/single": {
        post: {
          operationId: "checkSingleScenario",
          tags: ["Checks"],
          summary: "Check one scenario against an agent",
          description:
            `${scopeNote("probe")} Sends one scenario of a suite to one agent and grades it as a run grades it — rules, then the read-back, then two models — against the agent's newest policy, and answers with the verdict. ` +
            "It is not a run: it is recorded as a single-scenario check, never in a run, a report, a score, a coverage figure or a baseline, and never counted against the trial's runs or a plan's run allowance. Every answer carries `label: \"Single-scenario check — not a sealed run.\"`. " +
            "Funding is the run's: grading is on the workspace's own model key when it has one, and the check needs something that funds runs (the trial, a plan or a grant). " +
            "A destructive or fixture-only scenario is refused against an agent marked production (409 `production_guard`), in the runner's own words. 20 checks per workspace in any rolling hour (429 `rate_limited`, with `Retry-After`). " +
            "`?include=responses` adds the agent's reply and conversation, only for a key that also has the `responses` scope; otherwise personal data a grading model quoted is shown as placeholders. " +
            "Field names are also accepted in camelCase (`agentId`, `suiteSlug`, `suiteId`, `scenarioId`); answers are snake_case.",
          security: bearer,
          parameters: [
            { name: "include", in: "query", required: false, schema: { type: "string", enum: ["responses"] }, description: "`responses` adds the agent's reply. Needs the `responses` scope." },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["agent_id", "scenario_id"],
                  properties: {
                    agent_id: { ...UUID, description: "An agent from `GET /api/v1/agents`." },
                    suite: { type: "string", description: "A suite key, pinned (`eu-support-v5`) or newest (`eu-support`); the workspace's own suite first, then a built-in one. Send this or `suite_id`." },
                    suite_id: { ...UUID, description: "A suite from `GET /api/v1/suites`." },
                    scenario_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$", description: "A scenario id from that suite, such as `T07`." },
                    locale: { type: "string", enum: ["en", "de", "fr", "ro"], default: "en", description: "The language to send the scenario in. A scenario without a variant in that language is refused (422 `no_locale_variant`), never sent in English instead." },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "The scenario was sent and graded; the check is recorded.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ScenarioCheckAnswer" } } },
            },
            "400": errorResponse("The body is not a JSON object, or a field is malformed (`code`: `invalid_request`)."),
            "403": errorResponse("The key does not have the `probe` scope, or `include=responses` was asked without the `responses` scope (`code`: `missing_scope`)."),
            "404": errorResponse("No such agent, suite or scenario in this workspace (`code`: `not_found`)."),
            "409": errorResponse("The check cannot be sent: `production_guard`, `archived`, `no_policy`, `localisation_changed`, or `not_funded` (with `blocker`)."),
            "422": errorResponse("The scenario has no variant in the requested language (`code`: `no_locale_variant`)."),
            "413": errorResponse("The body is larger than 16 KB, so it was not read (`code`: `payload_too_large`)."),
            "429": {
              description: "20 single-scenario checks in the last hour (`code`: `rate_limited`, with `rate_limit.resets_at`), or more than 120 requests a minute for this key.",
              headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
              content: { "application/json": { schema: error } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "500": errorResponse("The scenario could not be run, or ran and could not be recorded (`code`: `not_run` or `not_recorded`)."),
            "503": errorResponse("The checks in the last hour could not be counted, so nothing was sent (`code`: `limit_unavailable`)."),
          },
        },
      },
      "/api/v1/production-failures": {
        post: {
          operationId: "recordProductionFailure",
          tags: ["Regressions"],
          summary: "Record a failure seen in production",
          description:
            `${scopeNote("write")} The text is redacted before it is stored and the original is never kept. It is drafted as a regression scenario that cannot run until a person approves it in Novera. ` +
            "The same text sent again answers 200 with the first record. A workspace can record 60 new failures an hour.",
          security: bearer,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["customer_message", "expected_behavior", "obligation", "severity"],
                  properties: {
                    customer_message: { type: "string", maxLength: 4000, description: "What the customer sent; the scenario will send it." },
                    expected_behavior: { type: "string", maxLength: 1000, description: "What should have happened, in one sentence." },
                    obligation: { type: "string", pattern: "^[a-z0-9_]+$", description: "An obligation key such as `data_minimisation`." },
                    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                    agent_reply: { type: "string", maxLength: 8000 },
                    what_went_wrong: { type: "string", maxLength: 1000 },
                    agent_id: UUID,
                    occurred_on: { type: "string", format: "date", examples: ["2026-09-29"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "This exact text was already recorded; nothing new was stored.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RecordedFailure" } } },
            },
            "201": {
              description: "Stored redacted, with a draft awaiting a person's approval.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RecordedFailure" } } },
            },
            "400": errorResponse("The body is not a JSON object, or a field is missing, too long or malformed. A field problem also carries `limits`."),
            "403": { $ref: "#/components/responses/MissingScope" },
            "404": errorResponse("No such agent in this workspace."),
            "429": {
              description: "Too many requests for this key, or 60 failures recorded by this workspace in the last hour.",
              headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
              content: { "application/json": { schema: error } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "500": errorResponse("The failure could not be recorded."),
            "503": {
              description: "The hourly allowance could not be counted, so the request was refused.",
              headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
              content: { "application/json": { schema: error } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "nvk_…",
          description:
            "A workspace API key created under Settings → API keys, MCP and webhooks. Scopes: `read` (always), `run`, `responses`, `write`, `probe`. 120 requests a minute per key. A wrong, unknown or revoked key gets the same 401.",
        },
      },
      headers: {
        RetryAfter: { description: "Seconds to wait before trying again.", schema: { type: "integer" } },
      },
      responses: {
        Unauthorized: {
          description: "No key was sent, or the key is not valid (wrong, unknown or revoked: the same answer).",
          headers: { "WWW-Authenticate": { schema: { type: "string", examples: ["Bearer"] } } },
          content: { "application/json": { schema: error } },
        },
        MissingScope: errorResponse("The key does not have the scope this operation needs."),
        RateLimited: {
          description: "More than 120 requests a minute for this key.",
          headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
          content: { "application/json": { schema: error } },
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            code: { type: "string", description: "A stable name for the refusal: on every authentication refusal (`unauthorized`, `missing_scope`, `rate_limited`, `unavailable`), on every single-scenario check refusal, and on run refusals naming the blocker." },
          },
        },
        Agent: {
          type: "object",
          required: ["id", "name", "host", "is_production", "policy_version", "created_at", "archived_at"],
          properties: {
            id: UUID,
            name: { type: "string" },
            host: { ...NULLABLE_STRING, description: "The host the agent is called on." },
            is_production: { type: "boolean", description: "Whether it serves real customers." },
            policy_version: { type: ["integer", "null"], description: "Latest policy version; null when there is none." },
            created_at: { type: "string", format: "date-time" },
            archived_at: { ...NULLABLE_STRING, format: "date-time" },
          },
        },
        ConnectionTest: {
          type: "object",
          required: ["outcome", "ok", "headline", "detail", "status_code", "latency_ms", "stored"],
          properties: {
            outcome: { type: "string", enum: ["ok", "timeout", "unreachable", "refused_address", "unauthorized", "http_error", "redirect", "too_large", "not_json", "no_reply_at_path"] },
            ok: { type: "boolean", description: "True only for `ok`: the reply text was found at the reply path." },
            headline: { type: "string", description: "One sentence for a person. The wording may change; `outcome` does not." },
            detail: { type: "string" },
            status_code: { type: ["integer", "null"], description: "The endpoint's HTTP status; null when nothing answered." },
            latency_ms: { type: ["integer", "null"], description: "Round trip, when a request was sent." },
            reply_preview: { type: "string", description: "On `ok`: the reply text, at most 200 characters." },
            reply_truncated: { type: "boolean" },
            top_level_keys: { type: "array", items: { type: "string" }, description: "On `no_reply_at_path`: the reply's top-level JSON keys. Names only, never values." },
            suggested_path: { ...NULLABLE_STRING, description: "On `no_reply_at_path`: where the reply text appears to be." },
            stored: { type: "boolean", const: false, description: "A test stores nothing." },
          },
        },
        Suite: {
          type: "object",
          required: ["id", "key", "version", "name", "scenarios", "built_in"],
          properties: {
            id: UUID,
            key: { type: "string" },
            version: { type: "integer" },
            name: { type: "string" },
            scenarios: { type: "integer", description: "How many scenarios the suite has." },
            built_in: { type: "boolean" },
          },
        },
        Counts: {
          type: "object",
          required: ["passed", "failed", "no_result"],
          description: "Computed from the run's stored scenarios. `no_result` is never a pass.",
          properties: { passed: { type: "integer" }, failed: { type: "integer" }, no_result: { type: "integer" } },
        },
        ReportRef: {
          type: ["object", "null"],
          required: ["content_hash", "url"],
          description: "The sealed report, when one was sealed and not withdrawn.",
          properties: { content_hash: { type: "string", description: "SHA-256 of the sealed content." }, url: { type: "string", format: "uri" } },
        },
        RunCommon: {
          type: "object",
          required: ["id", "agent", "suite", "policy_version", "status", "started_by", "created_at", "finished_at", "counts", "outcome", "outcome_reason", "report"],
          properties: {
            id: UUID,
            agent: { type: "object", required: ["id", "name"], properties: { id: UUID, name: NULLABLE_STRING } },
            suite: { ...NULLABLE_STRING, description: "For example `eu-support v5`." },
            policy_version: { type: ["integer", "null"] },
            status: { type: "string", description: "The run's state, for example queued, running, completed or aborted." },
            started_by: { type: "string", enum: ["person", "api_key", "schedule"] },
            created_at: { type: "string", format: "date-time" },
            finished_at: { ...NULLABLE_STRING, format: "date-time" },
            counts: { $ref: "#/components/schemas/Counts" },
            outcome: { type: "string", enum: ["pass", "fail", "incomplete"], description: "The CI decision, read from the sealed report. Gate on this, not on the counts." },
            outcome_reason: { type: "string" },
            report: { $ref: "#/components/schemas/ReportRef" },
          },
        },
        RunSummary: { allOf: [{ $ref: "#/components/schemas/RunCommon" }] },
        RunDetail: {
          allOf: [
            { $ref: "#/components/schemas/RunCommon" },
            {
              type: "object",
              required: ["error", "manifest_hash", "cases"],
              properties: {
                error: NULLABLE_STRING,
                manifest_hash: { ...NULLABLE_STRING, description: "Hash of what the run declared before it executed." },
                cases: { type: "array", items: { $ref: "#/components/schemas/Case" } },
              },
            },
          ],
        },
        Case: {
          type: "object",
          required: ["id", "category", "obligation", "severity", "verdict", "rationale", "error", "settled_by", "agreement", "graded_by", "evidence_gap", "failed_assertions", "stability"],
          properties: {
            id: { type: "string" },
            category: { type: "string" },
            obligation: { type: "string" },
            severity: { type: "string" },
            verdict: { type: "string", enum: ["pass", "fail", "no_result"], description: "`no_result` covers errored and unexecuted scenarios; it is never a pass." },
            rationale: { ...NULLABLE_STRING, description: "Personal data a grader quoted is a placeholder unless `include=responses` was granted." },
            error: NULLABLE_STRING,
            settled_by: { ...NULLABLE_STRING, description: "How the verdict was settled, for example deterministic rules." },
            agreement: { ...NULLABLE_STRING, description: "Whether the graders agreed." },
            graded_by: NULLABLE_STRING,
            evidence_gap: NULLABLE_STRING,
            failed_assertions: { type: "array", items: { type: "string" } },
            stability: {
              type: ["object", "null"],
              description: "Null unless this scenario's verdict has moved before under the same policy version.",
              required: ["passes", "fails", "runs", "moved"],
              properties: {
                passes: { type: "integer" }, fails: { type: "integer" }, runs: { type: "integer" },
                moved: { type: "string", description: "`graders` when the agent's reply was identical in runs graded differently, `agent` when its replies differed, `unknown` when that cannot be told." },
              },
            },
            input: { type: "string", description: "Only with `include=responses` and the `responses` scope. Exactly as stored." },
            response: { ...NULLABLE_STRING, description: "Only with `include=responses` and the `responses` scope. The agent's reply." },
            transcript: { description: "Only with `include=responses` and the `responses` scope. Turn by turn for a conversation; null for a single message." },
            raw_expired_at: { type: "string", format: "date-time", description: "Only with `include=responses`, and only once the raw evidence passed the workspace's retention period." },
            raw_sha256: { ...NULLABLE_STRING, description: "Only with `include=responses`, alongside `raw_expired_at`: SHA-256 of the reply that was removed." },
          },
        },
        StartedRun: {
          type: "object",
          required: ["run", "next"],
          properties: {
            run: { type: "object", required: ["id", "status"], properties: { id: UUID, status: { type: "string" } } },
            replayed: { type: "boolean", const: true, description: "Present only when an earlier request with this Idempotency-Key started the run." },
            next: { type: "string", description: "What to call to advance the run." },
          },
        },
        Advance: {
          type: "object",
          required: ["status", "started", "done"],
          properties: {
            status: { type: "string" },
            started: { type: "boolean", description: "False when another call was already working on the run, or it was already over." },
            done: { type: "boolean" },
            waiting: { type: "string", const: "grading_capacity", description: "Present when the run waits for a free grading slot on the shared trial keys." },
            graded: { type: "integer" },
            passed: { type: "integer" },
            failed: { type: "integer" },
            errored: { type: "integer" },
          },
        },
        CiTriggered: {
          type: "object",
          required: ["run", "deduplicated", "next", "poll_url", "superseded"],
          properties: {
            run: { type: "object", required: ["id", "status"], properties: { id: UUID, status: { type: "string" } } },
            deduplicated: { type: "boolean", description: "True when this commit already had a run on this agent and suite." },
            next: { type: "string", description: "What to call to advance the run." },
            poll_url: { type: "string", format: "uri", description: "`GET` it for the exit code once the run is done." },
            superseded: { type: "array", items: UUID, description: "Runs of earlier commits on this branch that this request stopped." },
          },
        },
        CiRun: {
          type: "object",
          required: ["run", "ci_exit_code", "ci_exit_reason", "report", "suite_digest", "baseline_comparison"],
          properties: {
            run: {
              type: "object",
              required: ["id", "status", "agent_id", "suite", "created_at", "finished_at", "git_commit_sha", "git_branch", "pr_number"],
              properties: {
                id: UUID, status: { type: "string" }, agent_id: UUID, suite: NULLABLE_STRING,
                created_at: { type: "string", format: "date-time" }, finished_at: { ...NULLABLE_STRING, format: "date-time" },
                git_commit_sha: NULLABLE_STRING, git_branch: NULLABLE_STRING, pr_number: { type: ["integer", "null"] },
              },
            },
            ci_exit_code: { type: ["integer", "null"], enum: [0, 1, 2, 3, 4, null], description: "Null while the run is queued or running." },
            ci_exit_reason: { type: "string" },
            report: {
              type: ["object", "null"],
              required: ["content_hash", "url", "verify_url"],
              properties: {
                content_hash: { type: "string" },
                url: { type: "string", format: "uri", description: "The report's link, which grants access to it. Keep it out of public logs." },
                verify_url: { type: "string", format: "uri", description: "The public seal check, which shows no content." },
              },
            },
            suite_digest: { ...NULLABLE_STRING, description: "SHA-256 of the suite the run declared; null for runs declared before 2026-10-15." },
            baseline_comparison: {
              type: ["object", "null"],
              required: ["base_run_id", "compare_url", "newly_broken", "fixed", "graders_moved", "summary"],
              properties: {
                base_run_id: UUID,
                compare_url: { type: "string", format: "uri" },
                newly_broken: { type: "array", items: { type: "string" }, description: "Scenario ids that passed before and fail now." },
                fixed: { type: "array", items: { type: "string" } },
                graders_moved: { type: "array", items: { type: "string" }, description: "Verdicts that moved on an identical reply; never counted as fixed or broken." },
                summary: { type: "string", examples: ["No previously passing scenario failed", "2 previously passing scenarios now fail"] },
              },
            },
          },
        },
        ScenarioCheckAnswer: {
          type: "object",
          required: ["check", "label", "rate_limit"],
          properties: {
            label: { type: "string", const: "Single-scenario check — not a sealed run." },
            rate_limit: {
              type: "object",
              required: ["remaining", "resets_at"],
              properties: {
                remaining: { type: "integer", minimum: 0, description: "Checks left in the rolling hour." },
                resets_at: { type: "string", format: "date-time", description: "When the oldest check in the window leaves it." },
              },
            },
            check: {
              type: "object",
              required: ["id", "origin", "scenario_id", "locale", "policy_version", "verdict", "no_verdict_reason", "settled_by", "reasons", "failed_assertions", "read_back", "graders", "created_at"],
              properties: {
                id: UUID,
                origin: { type: "string", enum: ["suite_case", "run_case"] },
                agent_id: { ...UUID },
                suite: { ...NULLABLE_STRING, examples: ["eu-support v5"] },
                scenario_id: { type: "string" },
                locale: { type: "string", enum: ["en", "de", "fr", "ro"] },
                policy_version: { type: "integer", description: "The agent's newest policy version, which it was graded against." },
                verdict: { type: "string", enum: ["pass", "fail", "error", "no_verdict"], description: "`error`: the scenario could not be run or read. `no_verdict`: it ran and the evidence does not support a verdict. Neither is a pass." },
                no_verdict_reason: { type: ["string", "null"], enum: ["disputed", "no_tool_evidence", "no_state_evidence", "read_back_unavailable", null] },
                settled_by: { type: ["string", "null"], enum: ["deterministic", "read_back", "models", null] },
                agreement: NULLABLE_STRING,
                reasons: { type: "array", items: { type: "string" }, description: "The grading rationale and any error, personal data as placeholders unless replies were asked for." },
                failed_assertions: { type: "array", items: { type: "string" } },
                read_back: {
                  type: ["object", "null"],
                  properties: { status: { type: "string", enum: ["confirmed", "contradicted", "unavailable"] }, detail: { type: "string" }, connector: { type: "string" }, mode: { type: "string" } },
                },
                graders: {
                  type: "array",
                  items: { type: "object", required: ["model", "verdict", "read_placeholders"], properties: { model: { type: "string" }, verdict: { type: "string" }, read_placeholders: { type: "boolean" } } },
                },
                graded_on: { type: ["string", "null"], enum: ["trial_free", "workspace_key", "plan_managed", null], description: "What funded the grading." },
                latency_ms: { type: ["integer", "null"] },
                created_at: { type: "string", format: "date-time" },
                response: { ...NULLABLE_STRING, description: "Only with `include=responses` and the `responses` scope." },
                transcript: { description: "Only with `include=responses` and the `responses` scope; null for a single-message scenario." },
              },
            },
          },
        },
        RecordedFailure: {
          type: "object",
          required: ["production_failure", "draft", "redaction", "note"],
          properties: {
            production_failure: { type: "object", required: ["id", "duplicate"], properties: { id: UUID, duplicate: { type: "boolean" } } },
            draft: {
              type: ["object", "null"],
              required: ["id", "scenario_id", "status", "review_url"],
              properties: { id: UUID, scenario_id: { type: "string", description: "For example `R01`." }, status: { type: "string", const: "draft" }, review_url: { type: "string", format: "uri" } },
            },
            redaction: { type: "object", required: ["removed", "original_kept"], properties: { removed: {}, original_kept: { type: "boolean", const: false } } },
            note: { type: "string" },
          },
        },
      },
    },
  };
}
