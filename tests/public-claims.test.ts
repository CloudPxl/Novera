import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// The home page states how many scenarios a run has. A new run uses the newest built-in
// eu-support version (startRun), so the claim is checked against that file: the line read
// "Forty-one" for a week after v5 made it 49.
const newest = readdirSync("data/suites")
  .map((f) => /^eu-support-v(\d+)\.json$/.exec(f))
  .filter((m): m is RegExpExecArray => m !== null)
  .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
const version = Number(newest[1]);
const count = (JSON.parse(readFileSync(`data/suites/${newest[0]}`, "utf8")) as { cases: unknown[] }).cases.length;

const UNITS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const inWords = (n: number) => (n % 10 ? `${TENS[Math.floor(n / 10)]}-${UNITS[n % 10]}` : TENS[n / 10]);

test("the home page states the scenario count of the suite a new run uses", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const word = inWords(count);
  assert.match(page, new RegExp(`${word[0].toUpperCase()}${word.slice(1)} scenarios`), `expected "${word} scenarios" (eu-support v${version} has ${count})`);
});

test("the sample report names the current suite and its size", () => {
  const sample = readFileSync("src/app/sample-report.tsx", "utf8");
  assert.match(sample, new RegExp(`eu-support v${version} · ${count} scenarios`));
  assert.doesNotMatch(sample, /\d+(\.\d+)?%(?! discount)/, "no percentage beside a withheld grade, as in a real report");
});
