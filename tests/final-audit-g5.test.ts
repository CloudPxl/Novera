import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubWorkflow } from "../src/lib/ci/workflow.ts";
import { readMcpBody } from "../src/lib/mcp/body.ts";
import { API_BODY_LIMIT } from "../src/lib/api/body.ts";

// ---- D-9: a 429 from the trigger is waited out, then exit 4, never exit 3 -----------------

const yml = githubWorkflow({ agentId: "agent-1", suite: "eu-support-v7" });

/** The "Start the run for this commit" script, exactly as the workflow runs it. */
function startScript(): string {
  const lines = yml.split("\n");
  const from = lines.findIndex((l) => l.includes("- name: Start the run for this commit"));
  const run = lines.findIndex((l, i) => i > from && l.trim() === "run: |");
  const out: string[] = [];
  for (const l of lines.slice(run + 1)) {
    if (l !== "" && !l.startsWith("          ")) break;
    out.push(l.slice(10));
  }
  return out.join("\n");
}

const haveTools = ["bash", "jq", "awk"].every((t) => spawnSync("sh", ["-c", `command -v ${t}`]).status === 0);

/** Runs the script with a scripted `curl` (answers in order, then repeats the last) and a `sleep` that only logs. */
function runStart(answers: Array<{ status: number; headers?: string; body?: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "novera-g5-"));
  writeFileSync(join(dir, "answers.json"), JSON.stringify(answers));
  // curl stub: finds -D <file> and -o <file>, writes the n-th scripted answer, prints the status for -w.
  writeFileSync(join(dir, "curl"), `#!/usr/bin/env bash
dir="$(dirname "$0")"
n=$(cat "$dir/count" 2>/dev/null || echo 0); echo $((n + 1)) > "$dir/count"
hdr=""; out=""
while [ $# -gt 0 ]; do case "$1" in -D) hdr="$2"; shift ;; -o) out="$2"; shift ;; esac; shift; done
a=$(jq -c --argjson n "$n" '.[ ([$n, length - 1] | min) ]' "$dir/answers.json")
[ -n "$hdr" ] && printf '%b' "$(jq -r '.headers // ""' <<<"$a")" > "$hdr"
jq -r '.body // "{}"' <<<"$a" > "$out"
jq -r '.status' <<<"$a"
`);
  writeFileSync(join(dir, "sleep"), `#!/usr/bin/env bash\necho "$1" >> "$(dirname "$0")/sleeps"\n`);
  chmodSync(join(dir, "curl"), 0o755);
  chmodSync(join(dir, "sleep"), 0o755);
  const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", startScript()], {
    cwd: dir,
    env: { PATH: `${dir}:${process.env.PATH}`, NOVERA_API: "https://x.test/api/v1", NOVERA_API_KEY: "nvk_test", NOVERA_AGENT_ID: "a", NOVERA_SUITE: "s", GIT_SHA: "abc", GIT_BRANCH: "b", PR_NUMBER: "", GITHUB_ENV: join(dir, "env") } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  const read = (f: string) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return ""; } };
  return { code: result.status, out: result.stdout + result.stderr, sleeps: read("sleeps").split("\n").filter(Boolean).map(Number), calls: Number(read("count") || 0), env: read("env") };
}

const busy = { status: 429, headers: "HTTP/2 429\\r\\nRetry-After: 20\\r\\n\\r\\n", body: '{"error":"This workspace already has 3 runs in progress","code":"concurrency"}' };
const started = { status: 202, body: '{"run":{"id":"run-1"},"deduplicated":false}' };

test("the generated workflow has a bounded 429 retry branch and no longer maps 429 to configuration", () => {
  const script = startScript();
  assert.match(script, /\[ "\$status" = "429" \] \|\| break/);
  assert.match(script, /-D trigger\.headers/);
  assert.match(script, /retry-after:/);
  assert.match(script, /-gt 300/, "total wait is capped at five minutes");
  assert.match(script, /"\$tries" -ge 10/, "tries are capped");
  assert.doesNotMatch(script, /409\|429/, "429 is no longer a configuration error");
  assert.match(script, /409\)\n\s+echo "The run was not started/, "409 still exits 3");
  // Secrets stay referenced, never inlined.
  assert.match(yml, /NOVERA_API_KEY: \$\{\{ secrets\.NOVERA_API_KEY \}\}/);
  assert.doesNotMatch(yml, /nvk_/);
});

test("a 429 is waited out by Retry-After and the run then starts (exit 0)", { skip: !haveTools }, () => {
  const r = runStart([busy, busy, started]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(r.sleeps, [20, 20]);
  assert.equal(r.calls, 3);
  assert.match(r.env, /NOVERA_RUN_ID=run-1/);
});

test("a 429 with no Retry-After waits 30 s; a tiny or huge one is clamped", { skip: !haveTools }, () => {
  assert.deepEqual(runStart([{ status: 429, body: "{}" }, started]).sleeps, [30]);
  assert.deepEqual(runStart([{ status: 429, headers: "Retry-After: 0\\r\\n", body: "{}" }, started]).sleeps, [5]);
  const huge = runStart([{ status: 429, headers: "Retry-After: 99999999999999999999\\r\\n", body: '{"error":"limited"}' }]);
  assert.equal(huge.code, 4, "a wait that cannot fit in five minutes gives up at once");
  assert.deepEqual(huge.sleeps, []);
});

test("a 429 that never clears exits 4 (infrastructure) within five minutes of waiting, never 3", { skip: !haveTools }, () => {
  const r = runStart([busy]);
  assert.equal(r.code, 4, r.out);
  assert.ok(r.sleeps.reduce((a, b) => a + b, 0) <= 300, `waited ${r.sleeps.reduce((a, b) => a + b, 0)} s`);
  assert.ok(r.calls <= 10);
  assert.match(r.out, /Not a finding about the agent/);
  // Retry-After 60: five tries fill the five minutes, the sixth gives up.
  const slow = runStart([{ ...busy, headers: "Retry-After: 60\\r\\n" }]);
  assert.equal(slow.code, 4);
  assert.deepEqual(slow.sleeps, [60, 60, 60, 60, 60]);
});

test("configuration refusals still exit 3 and server errors exit 4, without waiting", { skip: !haveTools }, () => {
  for (const status of [400, 401, 403, 404, 409]) {
    const r = runStart([{ status, body: '{"error":"no"}' }]);
    assert.equal(r.code, 3, `${status}: ${r.out}`);
    assert.deepEqual(r.sleeps, []);
  }
  assert.equal(runStart([{ status: 500, body: "{}" }]).code, 4);
});

test("the documentation still shows exactly the generated workflow and describes the 429 wait", () => {
  const doc = readFileSync("data/docs/integration-github-actions.md", "utf8");
  assert.equal(/```yaml\n([\s\S]*?)```/.exec(doc)?.[1], githubWorkflow({ agentId: "your-agent-id", suite: "eu-support-v7" }));
  assert.match(doc, /`429`[^.]*`Retry-After`/);
  assert.doesNotMatch(doc, /the fair-use limit was reached, or the run's report was withdrawn/);
  const api = readFileSync("data/docs/api.md", "utf8");
  assert.match(api, /re-running the job of an older commit/, "D-8: the superseding rule is documented, not guessed at");
});

// ---- D-11: MCP reads at most the REST limit, refused as JSON-RPC 413 ------------------------

const mcpReq = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/mcp", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

test("an MCP body within the limit is parsed", async () => {
  const body = await readMcpBody(mcpReq(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })));
  assert.ok(body.ok);
  assert.deepEqual((body as { message: unknown }).message, { jsonrpc: "2.0", id: 1, method: "tools/list" });
});

test("an MCP body past 64 KB is refused with 413 and a JSON-RPC error, declared or not, before parsing", async () => {
  const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(API_BODY_LIMIT + 1) } });
  for (const request of [mcpReq(big), mcpReq(big, { "content-length": String(big.length) })]) {
    const body = await readMcpBody(request);
    assert.ok(!body.ok);
    const response = (body as { response: Response }).response;
    assert.equal(response.status, 413);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const json = (await response.json()) as { jsonrpc: string; id: unknown; error: { code: number; message: string } };
    assert.equal(json.jsonrpc, "2.0");
    assert.equal(json.id, null);
    assert.equal(json.error.code, -32600);
    assert.match(json.error.message, /larger than 64 KB/);
  }
  // 3 MB, the size from the audit repro.
  const huge = await readMcpBody(mcpReq(JSON.stringify({ pad: "x".repeat(3 * 1024 * 1024) })));
  assert.ok(!huge.ok && (huge as { response: Response }).response.status === 413);
});

test("bad JSON on MCP is still a 400 parse error", async () => {
  const body = await readMcpBody(mcpReq("{not json"));
  assert.ok(!body.ok);
  const response = (body as { response: Response }).response;
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error: { code: number } }).error.code, -32700);
});

test("the MCP route reads its body through the limit, never request.json()", () => {
  const source = readFileSync("src/app/api/mcp/route.ts", "utf8");
  assert.doesNotMatch(source, /request\.json\(\)/);
  assert.match(source, /readMcpBody\(request\)/);
});
