import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * The published n8n templates are files a stranger downloads and imports. Each was run
 * in n8n before it shipped; these checks keep the properties that run proved from
 * quietly regressing when a template is regenerated or edited by hand.
 */
const DIR = new URL("../public/examples/", import.meta.url);
const templates = readdirSync(DIR).filter((f) => /^n8n-novera-.*\.json$/.test(f));

type Node = { name: string; type: string; parameters: Record<string, unknown>; credentials?: Record<string, { id: string; name: string }> };
type Workflow = { name: string; nodes: Node[]; connections: Record<string, { main: Array<Array<{ node: string }>> }> };
const load = (f: string) => JSON.parse(readFileSync(new URL(f, DIR), "utf8")) as Workflow;

test("there are four templates: the weekly run, the release gate, weekly assurance, incident to regression", () => {
  assert.deepEqual(templates.sort(), [
    "n8n-novera-incident-to-regression.json", "n8n-novera-release-gate.json", "n8n-novera-run-suite.json", "n8n-novera-weekly-assurance.json",
  ]);
});

for (const file of templates) {
  const wf = load(file);
  const text = JSON.stringify(wf);

  test(`${file}: carries no key, secret or real id`, () => {
    assert.doesNotMatch(text, /nvk_[A-Za-z0-9]/);
    assert.doesNotMatch(text, /Bearer [A-Za-z0-9]/);
    assert.doesNotMatch(text, /host\.docker\.internal|localhost/);
    for (const n of wf.nodes) for (const c of Object.values(n.credentials ?? {})) assert.equal(c.id, "REPLACE_WITH_YOUR_CREDENTIAL", `${n.name}`);
  });

  test(`${file}: every connection leads to a node that exists`, () => {
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [from, { main }] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), from);
      for (const branch of main) for (const to of branch) assert.ok(names.has(to.node), `${from} → ${to.node}`);
    }
  });

  test(`${file}: a webhook that starts work demands a secret`, () => {
    for (const n of wf.nodes.filter((x) => x.type === "n8n-nodes-base.webhook")) {
      assert.equal(n.parameters.authentication, "headerAuth", n.name);
      assert.ok(n.credentials?.httpHeaderAuth, n.name);
    }
  });
}

test("the release gate answers 200 only on the branch that requires a sealed report with nothing failed and nothing unresolved", () => {
  const wf = load("n8n-novera-release-gate.json");
  const gate = wf.nodes.find((n) => n.name === "Release may proceed?")!;
  const conditions = JSON.stringify(gate.parameters);
  // run.outcome is Novera's own decision over the sealed report (the CLI's and the webhook's), G5 included.
  for (const needle of ["run.outcome", "run.status", "counts.failed", "counts.no_result", "run.report"]) assert.ok(conditions.includes(needle), needle);
  assert.equal((gate.parameters as { conditions: { combinator: string } }).conditions.combinator, "and");
  assert.deepEqual(wf.connections["Release may proceed?"].main.map((b) => b.map((t) => t.node)), [["Respond: proceed"], ["Respond: blocked"]]);
  const code = (name: string) => (wf.nodes.find((n) => n.name === name)!.parameters.options as { responseCode: number }).responseCode;
  assert.equal(code("Respond: proceed"), 200);
  assert.equal(code("Respond: blocked"), 409);
  assert.equal(code("Respond: could not start"), 409);
});

test("a loop that waits on a run gives up after a bounded number of advances, and reports it as not finished", () => {
  for (const file of ["n8n-novera-release-gate.json", "n8n-novera-weekly-assurance.json", "n8n-novera-run-suite.json"]) {
    const finished = load(file).nodes.find((n) => n.name === "Finished?")!;
    assert.match(JSON.stringify(finished.parameters), /\$runIndex/, file);
  }
});

test("weekly assurance opens a ticket for a regression, a lost verdict or incomplete evidence — never for an unchanged failure alone", () => {
  const compare = load("n8n-novera-weekly-assurance.json").nodes.find((n) => n.name === "Compare")!.parameters.jsCode as string;
  assert.match(compare, /open_ticket: incomplete \|\| regressions\.length > 0/);
  assert.match(compare, /no_result > 0/);
  assert.match(compare, /run\.outcome === 'incomplete'/);
  assert.match(compare, /moved === 'graders'/);
});

test("every template that starts a run sends one Idempotency-Key per execution, retries, and takes a replay as started", () => {
  for (const file of templates) {
    const wf = load(file);
    const start = wf.nodes.find((n) => n.name === "Start run");
    if (!start) continue;
    const headers = (start.parameters.headerParameters as { parameters: Array<{ name: string; value: string }> } | undefined)?.parameters ?? [];
    assert.equal(headers.find((h) => h.name === "Idempotency-Key")?.value, "={{ $('Configure').item.json.idempotency_key }}", file);
    // Made once per execution, unique across reinstalls: an execution id alone restarts at 1.
    const configure = JSON.stringify(wf.nodes.find((n) => n.name === "Configure")?.parameters);
    assert.match(configure, /idempotency_key[^}]*\$execution\.id[^}]*\$now\.toMillis\(\)/, `${file}: the key is built in Configure`);
    assert.equal((start as unknown as { retryOnFail?: boolean }).retryOnFail, true, `${file}: a failed request is retried`);
    const started = wf.nodes.find((n) => n.name === "Run started?");
    if (started) assert.match(JSON.stringify(started.parameters), /replayed === true/, `${file}: a 200 replay is the same run, not a refusal`);
  }
});

test("the run-suite template passes only when Novera's own outcome is pass", () => {
  const check = load("n8n-novera-run-suite.json").nodes.find((n) => n.name === "Every scenario passed?")!;
  assert.match(JSON.stringify(check.parameters), /run\.outcome/);
});
