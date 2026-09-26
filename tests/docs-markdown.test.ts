import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseDocBody, parseSpans, plainText } from "../src/lib/docs/markdown.ts";

/**
 * The documentation is the only material the support agent may quote, with citations.
 * A page that renders its own source is a page that produces confident, sourced,
 * wrong-looking replies — and it was rendering literal backticks for a year.
 */

test("inline code, emphasis and strong are read, not printed", () => {
  assert.deepEqual(parseSpans("A `state_confirmed` claim is *withheld*, not **failed**."), [
    { kind: "text", text: "A " },
    { kind: "code", text: "state_confirmed" },
    { kind: "text", text: " claim is " },
    { kind: "em", text: "withheld" },
    { kind: "text", text: ", not " },
    { kind: "strong", text: "failed" },
    { kind: "text", text: "." },
  ]);
});

test("an asterisk that is not emphasis stays an asterisk", () => {
  assert.deepEqual(parseSpans("2 * 3 = 6"), [{ kind: "text", text: "2 * 3 = 6" }]);
  assert.deepEqual(parseSpans("**"), [{ kind: "text", text: "**" }]);
});

test("a heading is its own block, with its level", () => {
  const blocks = parseDocBody("## What is sent where\n\nThe agent's reply goes to the graders.");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { kind: "heading", level: 2, spans: [{ kind: "text", text: "What is sent where" }] });
  assert.equal(blocks[1].kind, "paragraph");
});

test("a hard-wrapped paragraph is one paragraph", () => {
  // The corpus is wrapped at about 100 columns. One paragraph per wrapped line would
  // turn every page into a column of fragments.
  const blocks = parseDocBody("The database runs in Frankfurt,\nin the EU, and that is\nwhere it stays.");
  assert.equal(blocks.length, 1);
  assert.equal(plainText(blocks[0]), "The database runs in Frankfurt, in the EU, and that is where it stays.");
});

test("bullets and numbers become one list, not four paragraphs", () => {
  const bullets = parseDocBody("- connect the agent\n- write the policy\n- run the suite");
  assert.equal(bullets.length, 1);
  assert.deepEqual(bullets[0], {
    kind: "list",
    ordered: false,
    items: [
      [{ kind: "text", text: "connect the agent" }],
      [{ kind: "text", text: "write the policy" }],
      [{ kind: "text", text: "run the suite" }],
    ],
  });
  const numbered = parseDocBody("1. first\n2. second");
  assert.equal(numbered[0].kind === "list" && numbered[0].ordered, true);
});

test("nothing here can produce markup", () => {
  // These pages will one day be edited by someone who is not us. Every construct
  // resolves to text in a typed span; there is no path from document to HTML.
  const blocks = parseDocBody('<script>alert(1)</script>\n\n<img src=x onerror=y>');
  assert.equal(blocks.length, 2);
  assert.equal(plainText(blocks[0]), "<script>alert(1)</script>");
  assert.ok(blocks.every((b) => b.kind === "paragraph"));
});

test("every published page in the corpus parses, and none renders its own syntax", () => {
  const dir = "data/docs";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 8, `expected the corpus, found ${files.length} files`);

  for (const file of files) {
    const raw = readFileSync(`${dir}/${file}`, "utf8");
    const body = raw.split(/^---$/m).slice(2).join("---");
    const blocks = parseDocBody(body);
    assert.ok(blocks.length > 0, `${file} produced no blocks`);

    for (const block of blocks) {
      const text = plainText(block);
      assert.doesNotMatch(text, /`/, `${file} renders a literal backtick: ${text.slice(0, 60)}`);
      assert.doesNotMatch(text, /^#{1,6} /, `${file} renders a literal heading marker`);
    }
  }
});

test("a fenced block keeps its lines and blank lines, and its text stays text", () => {
  const body = "Before.\n\n```yaml\nsteps:\n  - run: a\n\n  - run: <script>b</script>\n```\n\nAfter.";
  const blocks = parseDocBody(body);
  assert.deepEqual(blocks.map((b) => b.kind), ["paragraph", "codeblock", "paragraph"]);
  assert.equal((blocks[1] as { text: string }).text, "steps:\n  - run: a\n\n  - run: <script>b</script>");
});
