import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseDocBody } from "../src/lib/docs/markdown.ts";
import { highlight } from "../src/lib/docs/highlight.ts";

/** Highlighting adds colour and nothing else: the tokens, joined, are the input. */
const joined = (text: string, lang: string | null) => highlight(text, lang).map((t) => t.text).join("");

test("a fenced block captures its language and keeps its content exactly", () => {
  const body = "Intro.\n\n```yaml\nsteps:\n  - run: a\n\n  - run: <script>b</script>\n```\n\n```\nplain\n```";
  const blocks = parseDocBody(body);
  assert.deepEqual(blocks[1], { kind: "codeblock", lang: "yaml", text: "steps:\n  - run: a\n\n  - run: <script>b</script>" });
  assert.deepEqual(blocks[2], { kind: "codeblock", lang: null, text: "plain" });
});

test("a language label that is not a plain word is dropped, not trusted", () => {
  const blocks = parseDocBody("```<img src=x onerror=y>\ncode\n```");
  assert.equal((blocks[0] as { lang: string | null }).lang, null);
});

test("every token list joins back to the exact source, in every language", () => {
  const samples: Record<string, string> = {
    yaml: "name: AI gate # c\non:\n  push:\n    branches: [main]\nrun: echo ${{ secrets.X }} \"a\\\"b\" 'c' 42\n",
    bash: "key=\"github-$GITHUB_RUN_ID\"\n# note\ncurl -fsS \"$api\" | jq -r '.x' && exit ${code:-1}\n",
    ts: "import { a } from \"b\";\n// c\nconst x = `t ${1}` + 3.5; /* d */ return null;\n",
    python: "def f(x):\n    \"\"\"doc\"\"\"\n    return {\"a\": 1}  # c\n",
    json: '{\n  "a": [1, 2.5e3, true, null],\n  "b": "x\\"y"\n}',
  };
  for (const [lang, text] of Object.entries(samples)) assert.equal(joined(text, lang), text, lang);
});

test("hostile input is still only text", () => {
  const hostile = '<script>alert(1)</script> "unterminated\n`back\n</code></pre><img src=x onerror=y>';
  for (const lang of ["ts", "bash", "yaml", "python", "json", "unknown", null]) {
    assert.equal(joined(hostile, lang), hostile, String(lang));
  }
});

test("an unknown or missing language is one plain token", () => {
  assert.deepEqual(highlight("a b", "klingon"), [{ type: "plain", text: "a b" }]);
  assert.deepEqual(highlight("a b", null), [{ type: "plain", text: "a b" }]);
});

test("tokens are classified", () => {
  const types = (t: string, l: string) => highlight(t, l).filter((x) => x.type !== "plain").map((x) => `${x.type}:${x.text}`);
  assert.deepEqual(types('name: "x" # hi', "yaml"), ["key:name", 'string:"x"', "comment:# hi"]);
  assert.deepEqual(types('{"a": 1}', "json"), ['key:"a"', "number:1"]);
  assert.deepEqual(types("echo $HOME", "bash"), ["keyword:echo", "variable:$HOME"]);
  // A word is not entered halfway: `if` inside `diff` is not a keyword.
  assert.deepEqual(types("diff", "ts"), []);
});

test("every fenced block in the corpus survives highlighting unchanged and names a language", () => {
  for (const file of readdirSync("data/docs").filter((f) => f.endsWith(".md"))) {
    const raw = readFileSync(`data/docs/${file}`, "utf8");
    for (const block of parseDocBody(raw.split(/^---$/m).slice(2).join("---"))) {
      if (block.kind === "codeblock") assert.equal(joined(block.text, block.lang), block.text, file);
    }
  }
});

test("the integration guides exist, are published, and label every fence", () => {
  for (const slug of ["integration-github-actions", "integration-vercel-ai-sdk", "integration-langgraph-python"]) {
    const raw = readFileSync(`data/docs/${slug}.md`, "utf8");
    assert.match(raw, /^---\ntitle: [^"\n]+\npublished: true\n---\n/);
    const blocks = parseDocBody(raw.split(/^---$/m).slice(2).join("---")).filter((b) => b.kind === "codeblock");
    assert.ok(blocks.length > 0, slug);
    for (const b of blocks) assert.ok(b.kind === "codeblock" && b.lang, `${slug} has an unlabelled fence`);
  }
});
