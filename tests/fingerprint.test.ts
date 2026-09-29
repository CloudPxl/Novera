import { test } from "node:test";
import assert from "node:assert/strict";
import { agentConfigHash, buildRunManifest, cleanDeclared, fingerprintFromManifest } from "../src/lib/report/manifest.ts";

const config = { kind: "http", url: "https://agent.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply", headers: { "x-api-version": "2" }, authHeaderName: "authorization" };

test("the configuration digest covers the request's shape and never a credential or header value", () => {
  const a = agentConfigHash(config);
  assert.equal(a, agentConfigHash({ ...config, headers: { "x-api-version": "3" } }), "a header value is not part of it");
  assert.equal(a, agentConfigHash({ ...config, authValue: "sk-secret" }), "a credential is not part of it");
  assert.notEqual(a, agentConfigHash({ ...config, responsePath: "data.reply" }));
  assert.notEqual(a, agentConfigHash({ ...config, url: "https://agent.example/v2/chat" }));
  assert.equal(agentConfigHash(null), null);
});

test("a declaration is trimmed, bounded and printable; nothing declared is nothing stored", () => {
  assert.deepEqual(cleanDeclared({ releaseId: " 2026.09.3 ", knowledgeBaseRevision: "" }), { releaseId: "2026.09.3" });
  assert.deepEqual(cleanDeclared({}), {});
  assert.match((cleanDeclared({ releaseId: "x".repeat(101) }) as { error: string }).error, /at most 100/);
  assert.match((cleanDeclared({ releaseId: "a\u0000b" }) as { error: string }).error, /printable/);
  assert.match((cleanDeclared({ knowledgeBaseRevision: 42 }) as { error: string }).error, /must be text/);
});

const manifestWith = (declared?: { releaseId?: string; knowledgeBaseRevision?: string }) => buildRunManifest({
  runId: "r", agentId: "a", agentUrl: config.url, policyId: "p", policyVersion: 1, suiteId: "s", suiteKey: "eu-support",
  suiteVersion: 5, caseIds: ["T01"], judgeSource: "trial_free", passThreshold: 80, runnerVersion: "x", agentConfig: config, declared,
}).manifest;

test("each item says where it came from: recorded by Novera, declared, or not supplied", () => {
  const fp = fingerprintFromManifest(manifestWith({ releaseId: "2026.09.3" }))!;
  assert.deepEqual(fp.map((f) => [f.field, f.provenance]), [
    ["agent_endpoint", "recorded"], ["request_configuration", "recorded"],
    ["agent_release", "declared"], ["knowledge_base_revision", "not_supplied"],
  ]);
  assert.equal(fp[0].value, "agent.example");
  assert.equal(fp[2].value, "2026.09.3");
});

test("a manifest from before the digest existed produces no fingerprint rather than a guessed one", () => {
  const old = { ...manifestWith(), agent: { id: "a", endpoint_host: "agent.example" } };
  assert.equal(fingerprintFromManifest(old), null);
  assert.equal(fingerprintFromManifest(null), null);
  assert.equal("declared" in manifestWith(), false, "nothing declared, no declared block");
});
