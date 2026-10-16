import type { MetadataRoute } from "next";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { SITE_ORIGIN as ORIGIN } from "../lib/seo/site.ts";
import { docFile, lastCommitDate } from "../lib/seo/doc-dates.ts";

/**
 * The public, indexable pages. Documentation slugs are the files in `data/docs`, which is what
 * `seed:docs` publishes; built once, like the rest of the site, with each file's last commit
 * date as `lastModified` (left out when git history is unavailable, never faked).
 * `/status` is listed: its components are measured when it loads. `/legal` (drafts, noindex)
 * and `/verify/<hash>` (a private lookup, noindex) are deliberately not listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const docs = readdirSync(join(process.cwd(), "data/docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
  return [
    { url: `${ORIGIN}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${ORIGIN}/solutions`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${ORIGIN}/solutions/eu-ai-act`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${ORIGIN}/solutions/black-box-testing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${ORIGIN}/solutions/agency`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${ORIGIN}/solutions/regulatory-mapping`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${ORIGIN}/verify`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${ORIGIN}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${ORIGIN}/guide`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${ORIGIN}/apply`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${ORIGIN}/support`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${ORIGIN}/status`, changeFrequency: "always", priority: 0.3 },
    ...docs.map((slug) => {
      const lastModified = lastCommitDate(docFile(slug));
      return {
        url: `${ORIGIN}/docs/${slug}`,
        ...(lastModified ? { lastModified } : {}),
        changeFrequency: "monthly" as const,
        priority: 0.6,
      };
    }),
  ];
}
