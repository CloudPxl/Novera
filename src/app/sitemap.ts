import type { MetadataRoute } from "next";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "https://www.nover.space";

/**
 * The public, indexable pages. Documentation slugs are the files in `data/docs`, which is what
 * `seed:docs` publishes; built once, like the rest of the site. `/legal` (drafts, noindex) and
 * `/status` (set by hand) are deliberately not listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const docs = readdirSync(join(process.cwd(), "data/docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
  return [
    { url: `${ORIGIN}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${ORIGIN}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${ORIGIN}/guide`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${ORIGIN}/apply`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${ORIGIN}/support`, changeFrequency: "monthly", priority: 0.4 },
    ...docs.map((slug) => ({ url: `${ORIGIN}/docs/${slug}`, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
