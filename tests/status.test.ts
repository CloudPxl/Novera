import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, currentStatus, overall, COMPONENTS } from "../src/lib/status/status.ts";

test("the committed status file parses, with every component present", () => {
  const page = currentStatus({});
  assert.equal(page.problem, null);
  assert.ok(page.updatedAt);
  assert.deepEqual(page.components.map((c) => c.id), COMPONENTS.map((c) => c.id));
});

test("a broken or missing source shows every component as unknown, never operational", () => {
  for (const raw of [null, [], "x", {}, { updated_at: "not a date", components: { app: { state: "operational" } } }]) {
    const page = parseStatus(raw);
    assert.ok(page.problem);
    assert.ok(page.components.every((c) => c.state === "unknown"));
  }
  const fromEnv = currentStatus({ NOVERA_STATUS_JSON: "{not json" });
  assert.ok(fromEnv.components.every((c) => c.state === "unknown"));
});

test("an unrecognised state is unknown; a missing component is unknown; notes are capped", () => {
  const page = parseStatus({ updated_at: "2026-10-09T10:00:00Z", components: { app: { state: "up" }, email: { state: "degraded", note: "x".repeat(500) } } });
  assert.equal(page.components.find((c) => c.id === "app")!.state, "unknown");
  assert.equal(page.components.find((c) => c.id === "grading")!.state, "unknown");
  assert.equal(page.components.find((c) => c.id === "email")!.note!.length, 280);
});

test("the headline is the worst state; all-operational is the only way to say so", () => {
  const at = { updated_at: "2026-10-09T10:00:00Z" };
  const all = (state: string) => ({ ...at, components: Object.fromEntries(COMPONENTS.map((c) => [c.id, { state }])) });
  assert.equal(overall(parseStatus(all("operational"))).state, "operational");
  assert.equal(overall(parseStatus({ ...all("operational"), components: { ...all("operational").components, app: { state: "unknown" } } })).state, "unknown");
  assert.equal(overall(parseStatus({ ...all("maintenance"), components: { ...all("maintenance").components, email: { state: "degraded" } } })).state, "degraded");
});

test("the environment variable overrides the committed file", () => {
  const page = currentStatus({ NOVERA_STATUS_JSON: JSON.stringify({ updated_at: "2026-10-09T10:00:00Z", notice: "Planned work tonight", components: { app: { state: "maintenance" } } }) });
  assert.equal(page.notice, "Planned work tonight");
  assert.equal(page.components[0].state, "maintenance");
});
