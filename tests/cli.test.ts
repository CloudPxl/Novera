import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { exitForStatus, parseTarget, redactToken, verifyExport } from "../src/lib/cli/core.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";

const TOKEN = "TeSt0nlyNotARealReportToken00000";

test("a report link or a bare token resolves; anything else is refused", () => {
  assert.deepEqual(parseTarget(`https://www.nover.space/report/${TOKEN}`), { base: "https://www.nover.space", token: TOKEN });
  assert.deepEqual(parseTarget(`http://localhost:3000/report/${TOKEN}/`), { base: "http://localhost:3000", token: TOKEN });
  assert.deepEqual(parseTarget(TOKEN, "https://staging.example/"), { base: "https://staging.example", token: TOKEN });
  // Only origin and token are kept; the request is rebuilt from them, so nothing else
  // in a pasted link travels.
  assert.deepEqual(parseTarget(`https://www.nover.space/report/${TOKEN}?next=/settings#x`), { base: "https://www.nover.space", token: TOKEN });
  for (const bad of [
    `http://evil.test/report/${TOKEN}`, // plain http off localhost
    `https://www.nover.space/api/reports/${TOKEN}/export`, // not a report link
    "short",
    "../../etc/passwd",
  ]) {
    assert.ok("error" in parseTarget(bad), bad);
  }
});

test("a token is never printed whole", () => {
  assert.equal(redactToken(TOKEN), "TeSt…");
});

test("a refusal a retry cannot fix is 3; everything else from the server is 4", () => {
  for (const s of [400, 401, 403, 404, 410]) assert.equal(exitForStatus(s), 3, String(s));
  for (const s of [429, 500, 502, 503, 504]) assert.equal(exitForStatus(s), 4, String(s));
});

test("an export verifies only if its payload hashes to the digest it states", () => {
  const payload = { coverage: { passed: 3 }, subject: { agent: "Bot" } };
  const hash = contentHash(payload as Json);
  const ok = verifyExport({ content_hash: hash, payload, url: "https://www.nover.space/report/x" });
  assert.ok(ok.ok);

  const tampered = verifyExport({ content_hash: hash, payload: { ...payload, coverage: { passed: 4 } } });
  assert.equal(tampered.ok, false);
  assert.equal(!tampered.ok && tampered.code, 2);

  const notAnExport = verifyExport({ hello: "world" });
  assert.equal(!notAnExport.ok && notAnExport.code, 3);
});

test("the CLI starts under plain node, and a usage error is 3 — never 1, which means a failed scenario", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["--no-warnings", "bin/novera.mts", ...args], { encoding: "utf8" });
  const help = run("help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Exit codes/);
  assert.equal(run("nonsense").status, 3);
  assert.equal(run("report", "status", "not-a-token").status, 3);
  assert.equal(run("suite", "validate", "data/suites/eu-support-v4.json").status, 0);
});
