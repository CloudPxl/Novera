import { test } from "node:test";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GET as llms } from "../src/app/llms.txt/route.ts";
import { GET as openapi } from "../src/app/api/v1/openapi.json/route.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

const root = process.cwd();

// The sitemap (and what it imports) may use the "@/" alias, which Node does not know.
const hook = `export async function resolve(s, c, next) { return next(s.startsWith("@/") ? ${JSON.stringify(pathToFileURL(join(root, "src")).href)} + "/" + s.slice(2) : s, c); }`;
register("data:text/javascript," + encodeURIComponent(hook));

function routeFiles(dir: string, base = ""): string[] {
  return readdirSync(join(dir, base), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routeFiles(dir, join(base, e.name)) : e.name === "route.ts" ? [base] : [],
  );
}

test("llms.txt is plain text, starts with the H1, links every doc and passes the language rule", async () => {
  const res = llms();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain; charset=utf-8/);
  const text = await res.text();
  assert.ok(text.startsWith("# Novera"));
  assert.match(text, /^> /m);
  for (const f of readdirSync(join(root, "data/docs")).filter((f) => f.endsWith(".md"))) {
    assert.ok(text.includes(`https://www.nover.space/docs/${f.replace(/\.md$/, "")})`), `missing ${f}`);
  }
  assert.match(text, /not a certification/);
  assert.match(text, /0 pass, 1 fail, 2 incomplete, 3 configuration, 4 infrastructure/);
  assert.deepEqual(scanCustomerLanguage(text), []);
});

test("openapi is OpenAPI 3.1 JSON and matches the route files exactly", async () => {
  const res = openapi();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
  const doc = (await res.json()) as {
    openapi: string; servers: Array<{ url: string }>;
    paths: Record<string, Record<string, { responses?: Record<string, unknown>; security?: unknown[] }>>;
    components: { securitySchemes: Record<string, unknown> };
  };
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.servers[0].url, "https://www.nover.space");
  assert.ok(doc.components.securitySchemes.bearerAuth);

  const apiRoot = join(root, "src/app/api/v1");
  const onDisk = routeFiles(apiRoot).filter((d) => d !== "openapi.json").map((d) => `/api/v1/${d}`.replace(/\[(\w+)\]/g, "{$1}")).sort();
  assert.deepEqual(Object.keys(doc.paths).sort(), onDisk);
  for (const path of Object.keys(doc.paths)) {
    const file = join(apiRoot, path.replace("/api/v1/", "").replace(/\{(\w+)\}/g, "[$1]"), "route.ts");
    assert.ok(existsSync(file), `${path} has no route file`);
  }
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      assert.ok(op.responses && Object.keys(op.responses).length > 0, `${method} ${path} has no responses`);
      assert.ok(op.security && op.security.length > 0, `${method} ${path} has no security`);
    }
  }
});

test("sitemap lists only absolute public URLs", async () => {
  const { default: sitemap } = await import("../src/app/sitemap.ts");
  const entries = sitemap();
  assert.ok(entries.length > 0);
  for (const { url } of entries) {
    assert.ok(url.startsWith("https://www.nover.space"), url);
    const path = new URL(url).pathname;
    assert.doesNotMatch(path, /^\/(dashboard|runs|settings|api|report|billing|agents|scenarios)(\/|$)/, url);
    assert.doesNotMatch(path, /^\/verify\/./, url);
  }
});
