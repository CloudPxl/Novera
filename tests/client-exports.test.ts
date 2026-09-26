import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A "use client" module may export components and hooks, never a plain value.
 *
 * A constant exported from a client module reaches a server component as a client
 * reference, not as its value. `menuItemClass` did exactly that: interpolated into a
 * template literal on the server, it rendered its own source text as a class attribute
 * and a menu item lost all its styling. Nothing failed — it only looked wrong.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("no client module exports a non-function constant", () => {
  const offenders: string[] = [];
  for (const file of files("src")) {
    const source = readFileSync(file, "utf8");
    if (!/^\s*["']use client["'];?/.test(source)) continue;
    for (const match of source.matchAll(/^export const (\w+)\s*(?::[^=]+)?=\s*(?!\(|async\b|function\b|React\.|memo\(|forwardRef\()/gm)) {
      offenders.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `Move these to a module without "use client":\n${offenders.join("\n")}`);
});
