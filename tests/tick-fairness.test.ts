import { test } from "node:test";
import assert from "node:assert/strict";
import { roundRobin } from "../src/lib/schedules/tick.ts";

const item = (ws: string, n: number) => ({ ws, id: `${ws}${n}` });

test("one busy workspace cannot take every slot a tick has", () => {
  const items = [...[1, 2, 3, 4, 5, 6].map((n) => item("A", n)), item("B", 1), item("C", 1)];
  assert.deepEqual(roundRobin(items, (x) => x.ws, 4).map((x) => x.id), ["A1", "B1", "C1", "A2"]);
});

test("order within a workspace is kept, and a quiet tick takes everything", () => {
  const items = [item("A", 1), item("B", 1), item("A", 2)];
  assert.deepEqual(roundRobin(items, (x) => x.ws, 10).map((x) => x.id), ["A1", "B1", "A2"]);
  assert.deepEqual(roundRobin([], (x: { ws: string }) => x.ws, 5), []);
});
