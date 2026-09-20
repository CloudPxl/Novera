/**
 * Loads data/docs/*.md into doc_pages.
 *
 * These pages are both the public documentation and the entire corpus the support
 * agent may answer from, so seeding them is not a convenience — an answer can only
 * cite a row that exists here.
 *
 * Run: npm run seed:docs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const dir = "data/docs";

interface Parsed {
  title: string;
  published: boolean;
  body: string;
}

/** Minimal front matter: `title:` and `published:` between --- fences. */
function parse(raw: string, file: string): Parsed {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`${file}: no front matter`);

  const meta = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) meta.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }

  const title = meta.get("title");
  if (!title) throw new Error(`${file}: no title`);

  return { title, published: meta.get("published") !== "false", body: match[2].trim() };
}

let written = 0;
const problems: string[] = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
  const slug = file.replace(/\.md$/, "");
  try {
    const page = parse(readFileSync(join(dir, file), "utf8"), file);
    const { error } = await db
      .from("doc_pages")
      .upsert(
        { slug, title: page.title, body: page.body, published: page.published, updated_at: new Date().toISOString() },
        { onConflict: "slug" },
      );
    if (error) throw new Error(error.message);
    console.log(`  ${page.published ? "published" : "draft    "}  ${slug}`);
    written++;
  } catch (error) {
    problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const problem of problems) console.error(`  SKIPPED   ${problem}`);
console.log(`\n${written} page(s) seeded${problems.length ? `, ${problems.length} skipped` : ""}.\n`);
process.exit(problems.length ? 1 : 0);
