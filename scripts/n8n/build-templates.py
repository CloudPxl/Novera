"""
Builds the three agency templates in public/examples/ from one set of node shapes, so
the Configure node, the advance loop and the result checks are identical in every one —
the same shapes as n8n-novera-run-suite.json, which was proven in n8n.

Run: python3 scripts/n8n/build-templates.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "public" / "examples"
NOVERA_KEY = {"httpHeaderAuth": {"id": "REPLACE_WITH_YOUR_CREDENTIAL", "name": "Novera API key"}}
HTTP_V = 4.2
IF_V = 2.2
SET_V = 3.4
# Fifteen minutes of ten-second waits. A run that has not finished by then is reported
# as not finished — never left looping, and never read as a pass.
MAX_ADVANCES = 90


def node(name, type_, params, pos, version, **extra):
    n = {"parameters": params, "name": name, "type": f"n8n-nodes-base.{type_}", "typeVersion": version, "position": pos,
         "id": name.lower().replace(" ", "-").replace("?", "").replace(":", "").replace("→", "to").replace("—", "")}
    n.update(extra)
    return n


def assign(*pairs):
    return {"assignments": {"assignments": [
        {"id": f"a{i}", "name": k, "type": t, "value": v} for i, (k, t, v) in enumerate(pairs)
    ]}, "options": {}}


def cond(*items, combinator="and"):
    return {"conditions": {"options": {"caseSensitive": True, "typeValidation": "loose", "version": 2},
                           "conditions": [dict(id=f"c{i}", **it) for i, it in enumerate(items)],
                           "combinator": combinator}, "options": {}}


FULL = {"response": {"response": {"fullResponse": True, "neverError": True}}}
URL = "={{ $('Configure').item.json.novera_url }}"

# Starting a run is retried when the request itself fails (a timeout, a dropped
# connection), and the Idempotency-Key — one per execution — makes the retry return the
# run the first attempt started instead of starting, and paying for, a second.
# The key is made once, in Configure, from the execution id and the moment it ran: a retry
# re-reads Configure's output, so it repeats the key, while a reinstalled n8n (whose
# execution ids start again at 1) or a second instance never reuses one.
KEY = ("idempotency_key", "string", "={{ 'n8n-' + $execution.id + '-' + $now.toMillis() }}")
IDEMPOTENT = {"sendHeaders": True, "headerParameters": {"parameters": [
    {"name": "Idempotency-Key", "value": "={{ $('Configure').item.json.idempotency_key }}"}]}}
RETRY = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 2000}
# 201 is a new run; 200 with `replayed` is the same run, answered again to a retry.
STARTED = {"leftValue": "={{ $json.statusCode === 201 || ($json.statusCode === 200 && $json.body?.replayed === true) }}",
           "rightValue": True, "operator": {"type": "boolean", "operation": "true", "singleValue": True}}


def advance_loop(x, y, run_id_expr):
    """Advance → Finished? → (Wait 10 seconds → Advance) | Get result."""
    return [
        node("Advance run", "httpRequest", {
            "method": "POST", "url": f"{URL}/api/v1/runs/{{{{ {run_id_expr} }}}}/execute",
            "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
            "options": {"response": {"response": {"neverError": True}}}}, [x, y], HTTP_V, credentials=NOVERA_KEY),
        node("Finished?", "if", cond(
            {"leftValue": "={{ $json.done }}", "rightValue": True, "operator": {"type": "boolean", "operation": "true", "singleValue": True}},
            {"leftValue": "={{ $runIndex }}", "rightValue": MAX_ADVANCES, "operator": {"type": "number", "operation": "gte"}},
            combinator="or"), [x + 220, y], IF_V),
        node("Wait 10 seconds", "wait", {"amount": 10}, [x + 220, y + 220], 1.1, webhookId="novera-wait-10s"),
        node("Get result", "httpRequest", {
            "method": "GET", "url": f"{URL}/api/v1/runs/{{{{ {run_id_expr} }}}}",
            "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "options": {}},
            [x + 440, y], HTTP_V, credentials=NOVERA_KEY),
    ]


LOOP_CONNECTIONS = {
    "Advance run": [["Finished?"]],
    "Finished?": [["Get result"], ["Wait 10 seconds"]],
    "Wait 10 seconds": [["Advance run"]],
}

# Passed means: finished, sealed, nothing failed, nothing without a verdict — and Novera's
# own decision over the sealed report says pass (`run.outcome`, the one the CLI and the
# webhook use), which also refuses a pass one model gave alone (G5).
ALL_PASSED = [
    {"leftValue": "={{ $json.run.outcome }}", "rightValue": "pass", "operator": {"type": "string", "operation": "equals"}},
    {"leftValue": "={{ $json.run.status }}", "rightValue": "completed", "operator": {"type": "string", "operation": "equals"}},
    {"leftValue": "={{ $json.run.counts.failed }}", "rightValue": 0, "operator": {"type": "number", "operation": "equals"}},
    {"leftValue": "={{ $json.run.counts.no_result }}", "rightValue": 0, "operator": {"type": "number", "operation": "equals"}},
    {"leftValue": "={{ $json.run.report }}", "rightValue": "", "operator": {"type": "object", "operation": "exists", "singleValue": True}},
]
OUTCOME = "={{ $json.run.status !== 'completed' || !$json.run.report ? 'incomplete' : $json.run.counts.failed > 0 ? 'fail' : 'incomplete' }}"
WHY_NO_REPORT = "($json.run.error || ($json.run.status === 'completed' ? 'no scenario produced a verdict, so there was nothing to seal.' : 'the run did not finish (status: ' + $json.run.status + ').'))"


def connections(spec):
    return {src: {"main": [[{"node": n, "type": "main", "index": 0} for n in branch] for branch in branches]}
            for src, branches in spec.items()}


def workflow(name, nodes, conns, note):
    return {"name": name, "nodes": nodes, "connections": connections(conns),
            "settings": {"executionOrder": "v1"}, "pinData": {},
            "meta": {"templateCredsSetupCompleted": False, "novera": note}}


# ------------------------------------------------------------------ 1. pre-release gate
gate = workflow("Novera — pre-release gate", [
    node("Release pipeline calls", "webhook", {
        "httpMethod": "POST", "path": "novera-release-gate", "authentication": "headerAuth",
        "responseMode": "responseNode", "options": {}}, [0, 100], 2, webhookId="novera-release-gate",
        credentials={"httpHeaderAuth": {"id": "REPLACE_WITH_YOUR_CREDENTIAL", "name": "Release gate secret"}}),
    node("Configure", "set", assign(
        ("novera_url", "string", "https://www.nover.space"),
        ("agent_id", "string", "REPLACE_WITH_AGENT_ID"),
        ("suite_id", "string", "REPLACE_WITH_SUITE_ID"),
        ("release_id", "string", "={{ $json.body?.release_id ?? '' }}"),
        ("knowledge_base_revision", "string", "={{ $json.body?.knowledge_base_revision ?? '' }}"),
        KEY,
    ), [220, 100], SET_V),
    node("Start run", "httpRequest", {
        "method": "POST", "url": f"{URL}/api/v1/runs", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify(Object.assign({ agent_id: $('Configure').item.json.agent_id, suite_id: $('Configure').item.json.suite_id }, $('Configure').item.json.release_id ? { release_id: $('Configure').item.json.release_id } : {}, $('Configure').item.json.knowledge_base_revision ? { knowledge_base_revision: $('Configure').item.json.knowledge_base_revision } : {})) }}",
        **IDEMPOTENT, "options": FULL}, [440, 100], HTTP_V, credentials=NOVERA_KEY, **RETRY),
    node("Run started?", "if", cond(STARTED), [660, 100], IF_V),
    node("Respond: could not start", "respondToWebhook", {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ outcome: 'blocked', release_id: $('Configure').item.json.release_id || null, reason: 'The Novera run could not start: ' + ($json.body?.error ?? 'HTTP ' + $json.statusCode) }) }}",
        "options": {"responseCode": 409}}, [880, 320], 1.1),
    *advance_loop(880, 100, "$('Start run').item.json.body.run.id"),
    node("Release may proceed?", "if", cond(*ALL_PASSED), [1320, 100], IF_V),
    node("Respond: proceed", "respondToWebhook", {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ outcome: 'pass', release_id: $('Configure').item.json.release_id || null, counts: $json.run.counts, report_url: $json.run.report.url, message: 'Novera: all ' + $json.run.counts.passed + ' scenarios passed. Report: ' + $json.run.report.url }) }}",
        "options": {"responseCode": 200}}, [1540, 0], 1.1),
    node("Respond: blocked", "respondToWebhook", {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ outcome: " + OUTCOME[4:-3] + ", release_id: $('Configure').item.json.release_id || null, counts: $json.run.counts, report_url: $json.run.report ? $json.run.report.url : null, message: 'Novera: ' + $json.run.counts.failed + ' failed, ' + $json.run.counts.no_result + ' with no result, ' + $json.run.counts.passed + ' passed. A scenario with no result is not a pass. ' + ($json.run.outcome_reason ? $json.run.outcome_reason + ' ' : '') + ($json.run.report ? 'Report: ' + $json.run.report.url : 'No report was sealed: ' + " + WHY_NO_REPORT + ") }) }}",
        "options": {"responseCode": 409}}, [1540, 200], 1.1),
], {
    "Release pipeline calls": [["Configure"]],
    "Configure": [["Start run"]],
    "Start run": [["Run started?"]],
    "Run started?": [["Advance run"], ["Respond: could not start"]],
    **LOOP_CONNECTIONS,
    "Get result": [["Release may proceed?"]],
    "Release may proceed?": [["Respond: proceed"], ["Respond: blocked"]],
}, "A release pipeline POSTs {release_id, knowledge_base_revision} to this webhook and waits. 200 only when every scenario passed and a report was sealed; 409 otherwise, including when the run could not start or did not finish.")

# ------------------------------------------------------------- 2. weekly assurance
COMPARE = r"""
// Compares this run with the last completed run of the same suite for the same agent.
// Every number comes from Novera's stored verdicts; nothing is estimated here.
const run = $('Get result').first().json.run;
const base = $('Get baseline').isExecuted ? $('Get baseline').first().json.run : null;
const before = new Map((base?.cases ?? []).map((c) => [c.id, c.verdict]));
const newlyFailing = run.cases.filter((c) => c.verdict === 'fail' && before.get(c.id) === 'pass');
const lostVerdict = run.cases.filter((c) => c.verdict === 'no_result' && before.has(c.id) && before.get(c.id) !== 'no_result').map((c) => c.id);
const fixed = run.cases.filter((c) => c.verdict === 'pass' && before.get(c.id) === 'fail').map((c) => c.id);
// A newly failing scenario whose identical reply was graded both ways before is the
// graders moving, not the agent. It is still listed; it is labelled.
const gradersMoved = newlyFailing.filter((c) => c.stability?.moved === 'graders').map((c) => c.id);
const regressions = newlyFailing.map((c) => c.id);
const incomplete = run.status !== 'completed' || !run.report || run.counts.no_result > 0 || run.outcome === 'incomplete';
const report = run.report ? run.report.url : null;
const lines = [
  `Novera weekly check: ${run.agent.name} (${run.suite}) — ${run.counts.passed} passed, ${run.counts.failed} failed, ${run.counts.no_result} with no result.`,
  base ? `Compared with the run of ${base.created_at.slice(0, 10)}.` : 'No earlier completed run of this suite to compare with.',
  regressions.length ? `Newly failing: ${regressions.join(', ')}.` + (gradersMoved.length ? ` Of these, ${gradersMoved.join(', ')} had an identical reply graded both ways before — the graders moved, not necessarily the agent.` : '') : '',
  lostVerdict.length ? `No verdict this time: ${lostVerdict.join(', ')}.` : '',
  incomplete ? `The evidence is incomplete: ${run.outcome_reason ?? 'a scenario with no result is not a pass.'}` : '',
  fixed.length ? `Fixed since then: ${fixed.join(', ')}.` : '',
  report ? `Report: ${report}` : `No report was sealed${run.error ? ': ' + run.error : '.'}`,
].filter(Boolean);
return [{ json: {
  open_ticket: incomplete || regressions.length > 0,
  outcome: regressions.length ? 'regression' : incomplete ? 'incomplete' : 'no_change',
  baseline_run_id: base ? base.id : null,
  regressions, graders_moved: gradersMoved, lost_verdict: lostVerdict, fixed,
  report_url: report,
  title: regressions.length ? `Novera: ${regressions.length} scenario(s) newly failing for ${run.agent.name}` : `Novera: incomplete evidence for ${run.agent.name}`,
  message: lines.join('\n'),
} }];
""".strip()

PICK_BASELINE = r"""
// The last completed run of the same suite version, before this one.
const run = $('Get result').first().json.run;
const recent = $('Recent runs').first().json.runs ?? [];
const base = recent.find((r) => r.id !== run.id && r.status === 'completed' && r.suite === run.suite && r.created_at < run.created_at);
return [{ json: { baseline_run_id: base ? base.id : null } }];
""".strip()

weekly = workflow("Novera — weekly assurance against the last run", [
    node("Every Monday", "scheduleTrigger", {"rule": {"interval": [{"field": "weeks", "triggerAtDay": [1], "triggerAtHour": 6}]}}, [0, 0], 1.2),
    node("Run now", "manualTrigger", {}, [0, 200], 1),
    node("Configure", "set", assign(
        ("novera_url", "string", "https://www.nover.space"),
        ("agent_id", "string", "REPLACE_WITH_AGENT_ID"),
        ("suite_id", "string", "REPLACE_WITH_SUITE_ID"),
        KEY,
    ), [220, 100], SET_V),
    node("Start run", "httpRequest", {
        "method": "POST", "url": f"{URL}/api/v1/runs", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ agent_id: $('Configure').item.json.agent_id, suite_id: $('Configure').item.json.suite_id }) }}",
        **IDEMPOTENT, "options": FULL}, [440, 100], HTTP_V, credentials=NOVERA_KEY, **RETRY),
    node("Run started?", "if", cond(STARTED), [660, 100], IF_V),
    node("Could not start", "set", assign(
        ("open_ticket", "boolean", "={{ true }}"),
        ("outcome", "string", "not_started"),
        ("title", "string", "Novera: the weekly run could not start"),
        ("message", "string", "=The Novera run could not start: {{ $json.body?.error ?? 'HTTP ' + $json.statusCode }}"),
    ), [880, 320], SET_V),
    *advance_loop(880, 100, "$('Start run').item.json.body.run.id"),
    node("Recent runs", "httpRequest", {
        "method": "GET", "url": f"{URL}/api/v1/runs?agent={{{{ $('Configure').item.json.agent_id }}}}&limit=20",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "options": {}},
        [1540, 100], HTTP_V, credentials=NOVERA_KEY),
    node("Pick the baseline", "code", {"jsCode": PICK_BASELINE}, [1760, 100], 2),
    node("Has a baseline?", "if", cond(
        {"leftValue": "={{ $json.baseline_run_id }}", "rightValue": "", "operator": {"type": "string", "operation": "exists", "singleValue": True}}), [1980, 100], IF_V),
    node("Get baseline", "httpRequest", {
        "method": "GET", "url": f"{URL}/api/v1/runs/{{{{ $json.baseline_run_id }}}}",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "options": {}},
        [2200, 0], HTTP_V, credentials=NOVERA_KEY),
    node("Compare", "code", {"jsCode": COMPARE}, [2420, 100], 2),
    node("Regression or incomplete?", "if", cond(
        {"leftValue": "={{ $json.open_ticket }}", "rightValue": True, "operator": {"type": "boolean", "operation": "true", "singleValue": True}}), [2640, 100], IF_V),
    node("Open a ticket", "noOp", {}, [2860, 0], 1),
    node("Nothing to do", "noOp", {}, [2860, 200], 1),
], {
    "Every Monday": [["Configure"]],
    "Run now": [["Configure"]],
    "Configure": [["Start run"]],
    "Start run": [["Run started?"]],
    "Run started?": [["Advance run"], ["Could not start"]],
    "Could not start": [["Open a ticket"]],
    **LOOP_CONNECTIONS,
    "Get result": [["Recent runs"]],
    "Recent runs": [["Pick the baseline"]],
    "Pick the baseline": [["Has a baseline?"]],
    "Has a baseline?": [["Get baseline"], ["Compare"]],
    "Get baseline": [["Compare"]],
    "Compare": [["Regression or incomplete?"]],
    "Regression or incomplete?": [["Open a ticket"], ["Nothing to do"]],
}, "Weekly: runs the suite, compares with the last completed run of the same suite, and reaches 'Open a ticket' only on a newly failing scenario, a lost verdict, or incomplete evidence. Replace 'Open a ticket' with your Jira, Linear or email node; it receives title and message.")

# --------------------------------------------------------- 3. incident → regression
incident = workflow("Novera — incident to regression draft", [
    node("Helpdesk sends an incident", "webhook", {
        "httpMethod": "POST", "path": "novera-incident", "authentication": "headerAuth",
        "responseMode": "responseNode", "options": {}}, [0, 100], 2, webhookId="novera-incident",
        credentials={"httpHeaderAuth": {"id": "REPLACE_WITH_YOUR_CREDENTIAL", "name": "Incident webhook secret"}}),
    node("Configure", "set", assign(
        ("novera_url", "string", "https://www.nover.space"),
        ("agent_id", "string", ""),
        ("default_obligation", "string", "policy_accuracy"),
        ("default_severity", "string", "high"),
    ), [220, 100], SET_V),
    # Adapt these five expressions to your helpdesk's payload. Nothing else needs to change.
    node("Map the incident", "set", assign(
        ("customer_message", "string", "={{ $('Helpdesk sends an incident').item.json.body.customer_message }}"),
        ("agent_reply", "string", "={{ $('Helpdesk sends an incident').item.json.body.agent_reply ?? '' }}"),
        ("expected_behavior", "string", "={{ $('Helpdesk sends an incident').item.json.body.expected_behavior }}"),
        ("what_went_wrong", "string", "={{ $('Helpdesk sends an incident').item.json.body.what_went_wrong ?? '' }}"),
        ("occurred_on", "string", "={{ $('Helpdesk sends an incident').item.json.body.occurred_on ?? '' }}"),
        ("obligation", "string", "={{ $('Helpdesk sends an incident').item.json.body.obligation || $('Configure').item.json.default_obligation }}"),
        ("severity", "string", "={{ $('Helpdesk sends an incident').item.json.body.severity || $('Configure').item.json.default_severity }}"),
    ), [440, 100], SET_V),
    node("Record in Novera", "httpRequest", {
        "method": "POST", "url": f"{URL}/api/v1/production-failures",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify(Object.fromEntries(Object.entries({ customer_message: $json.customer_message, agent_reply: $json.agent_reply, expected_behavior: $json.expected_behavior, what_went_wrong: $json.what_went_wrong, occurred_on: $json.occurred_on, obligation: $json.obligation, severity: $json.severity, agent_id: $('Configure').item.json.agent_id }).filter(([, v]) => v !== '' && v !== null && v !== undefined))) }}",
        "options": FULL}, [660, 100], HTTP_V, credentials=NOVERA_KEY),
    node("Recorded?", "if", cond(
        {"leftValue": "={{ $json.statusCode }}", "rightValue": 300, "operator": {"type": "number", "operation": "lt"}}), [880, 100], IF_V),
    node("Respond: drafted", "respondToWebhook", {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ outcome: $json.body.production_failure.duplicate ? 'already_recorded' : 'drafted', scenario_id: $json.body.draft ? $json.body.draft.scenario_id : null, review_url: $json.body.draft ? $json.body.draft.review_url : null, removed: $json.body.redaction.removed, note: $json.body.note }) }}",
        "options": {"responseCode": 200}}, [1100, 0], 1.1),
    node("Tell the team", "set", assign(
        ("message", "string", "={{ $('Record in Novera').item.json.body.production_failure.duplicate ? 'Novera: this incident was already recorded as ' + $('Record in Novera').item.json.body.draft.scenario_id + '.' : 'Novera: incident drafted as regression scenario ' + $('Record in Novera').item.json.body.draft.scenario_id + '. It runs only after someone approves it: ' + $('Record in Novera').item.json.body.draft.review_url }}"),
    ), [1320, 0], SET_V),
    node("Respond: not recorded", "respondToWebhook", {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ outcome: 'not_recorded', status: $json.statusCode, error: $json.body?.error ?? 'HTTP ' + $json.statusCode }) }}",
        "options": {"responseCode": 422}}, [1100, 200], 1.1),
], {
    "Helpdesk sends an incident": [["Configure"]],
    "Configure": [["Map the incident"]],
    "Map the incident": [["Record in Novera"]],
    "Record in Novera": [["Recorded?"]],
    "Recorded?": [["Respond: drafted"], ["Respond: not recorded"]],
    "Respond: drafted": [["Tell the team"]],
}, "A helpdesk or incident tool POSTs a conversation that went wrong. Novera stores it redacted and drafts a regression scenario that runs only after a person approves it. The same incident sent twice is recorded once.")

for name, wf in [("n8n-novera-release-gate.json", gate), ("n8n-novera-weekly-assurance.json", weekly), ("n8n-novera-incident-to-regression.json", incident)]:
    (OUT / name).write_text(json.dumps(wf, indent=2, ensure_ascii=False) + "\n")
    print("wrote", name, len(wf["nodes"]), "nodes")
