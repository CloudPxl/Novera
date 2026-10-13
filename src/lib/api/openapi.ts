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
        "A key reads by default; starting runs, reading the agent's replies and recording failures need the `run`, `responses` and `write` scopes, chosen when the key is created. " +
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
            "A workspace API key created under Settings → API keys, MCP and webhooks. Scopes: `read` (always), `run`, `responses`, `write`. 120 requests a minute per key. A wrong, unknown or revoked key gets the same 401.",
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
            code: { type: "string", description: "Present on some run refusals, naming the blocker." },
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
