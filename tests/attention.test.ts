import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAttention, type AttentionInput } from "../src/app/(app)/dashboard/attention.ts";

const empty: AttentionInput = {
  agents: [],
  runs: [],
  outcomes: new Map(),
  latestProbe: new Map(),
  draftCount: 0,
};

const agent = { id: "a1", name: "Support bot", attested_at: "2026-09-01T00:00:00Z" };

test("nothing waiting means nothing is rendered", () => {
  // An "all clear" panel that is always on screen stops being read within a week, and
  // then the week it matters it is not read either.
  assert.deepEqual(buildAttention(empty), []);

  const healthy = buildAttention({
    ...empty,
    agents: [agent],
    runs: [{ id: "r1", status: "completed", agent_id: "a1" }],
    outcomes: new Map([["r1", { pass: 10, fail: 0, error: 0 }]]),
    latestProbe: new Map([["a1", { error: null }]]),
  });
  assert.deepEqual(healthy, []);
});

test("a run that has not finished is surfaced without being scored", () => {
  const items = buildAttention({
    ...empty,
    agents: [agent],
    runs: [{ id: "r2", status: "running", agent_id: "a1" }],
    // Counts exist for it — a run in flight has stored cases — and must not be used.
    outcomes: new Map([["r2", { pass: 3, fail: 1, error: 0 }]]),
  });

  assert.equal(items.length, 1);
  assert.match(items[0].text, /has not finished/);
  assert.equal(items[0].href, "/runs/r2");
  // A partial count shown as a result is the thing this product exists not to do.
  assert.equal(/\d+ (?:passed|failing)/.test(items[0].text), false);
});

test("a failed connection check and a missing authorisation are both broken states", () => {
  const items = buildAttention({
    ...empty,
    agents: [{ id: "a1", name: "Support bot", attested_at: null }],
    latestProbe: new Map([["a1", { error: "HTTP 502" }]]),
  });

  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.tone === "fail"));
  assert.match(items[0].text, /did not answer/);
  assert.match(items[1].text, /no recorded authorisation/);
});

test("only the most recent completed run is reported on", () => {
  // A list of every failing run ever is a list nobody reads.
  const items = buildAttention({
    ...empty,
    agents: [agent],
    runs: [
      { id: "new", status: "completed", agent_id: "a1" },
      { id: "old", status: "completed", agent_id: "a1" },
    ],
    outcomes: new Map([
      ["new", { pass: 9, fail: 1, error: 0 }],
      ["old", { pass: 1, fail: 9, error: 0 }],
    ]),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].href, "/runs/new");
  assert.match(items[0].text, /1 failing scenario\./);
});

test("failures and no-results are named separately, never summed", () => {
  const items = buildAttention({
    ...empty,
    agents: [agent],
    runs: [{ id: "r", status: "completed", agent_id: "a1" }],
    outcomes: new Map([["r", { pass: 4, fail: 10, error: 2 }]]),
  });

  assert.match(items[0].text, /10 failing scenarios and 2 with no result/);
});

test("a run with no result and no failure still asks to be looked at", () => {
  const items = buildAttention({
    ...empty,
    agents: [agent],
    runs: [{ id: "r", status: "completed", agent_id: "a1" }],
    outcomes: new Map([["r", { pass: 4, fail: 0, error: 3 }]]),
  });

  assert.equal(items.length, 1);
  assert.match(items[0].text, /^The last completed run found 3 with no result\.$/);
});

test("drafts waiting for a decision are counted, and read as English", () => {
  assert.match(buildAttention({ ...empty, draftCount: 1 })[0].text, /1 drafted scenario waiting/);
  assert.match(buildAttention({ ...empty, draftCount: 4 })[0].text, /4 drafted scenarios waiting/);
  assert.equal(buildAttention({ ...empty, draftCount: 0 }).length, 0);
});

test("every item can be acted on", () => {
  const items = buildAttention({
    ...empty,
    agents: [{ id: "a1", name: "Bot", attested_at: null }],
    runs: [{ id: "r", status: "completed", agent_id: "a1" }],
    outcomes: new Map([["r", { pass: 0, fail: 2, error: 0 }]]),
    latestProbe: new Map([["a1", { error: "down" }]]),
    draftCount: 2,
  });

  assert.equal(items.length, 4);
  for (const item of items) {
    assert.ok(item.href.startsWith("/"), `${item.text} has nowhere to go`);
    assert.ok(item.action.length > 0);
    assert.ok(item.text.endsWith("."));
  }
});
