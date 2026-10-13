import { SITE_ORIGIN } from "./site.ts";

export type JsonLdObject = Record<string, unknown>;

/**
 * Serialises structured data for a `<script type="application/ld+json">`. `<` is written as
 * `<` so a value can never close the tag or open a comment; JSON.parse reads it back
 * unchanged.
 */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * The home page. Name, category, description and the features the product really has — no
 * `offers` (prices are approved, not published) and no Organization (there is no legal entity
 * yet); both are added when those exist.
 */
export function softwareApplicationLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Novera",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: `${SITE_ORIGIN}/`,
    inLanguage: "en",
    description:
      "Runs a versioned scenario suite against an AI support agent and produces a dated, hash-sealed report of testing evidence for the EU AI Act and GDPR duties the operator already has to document. Evidence of testing, not a legal certification.",
    featureList: [
      "Versioned scenario suite run against a live AI support agent",
      "Verdicts from two models from different vendors",
      "Claimed actions checked against the agent's own system where a read-back exists",
      "Dated report sealed with a SHA-256 hash and chained to the previous report",
      "Coverage reported as execution, resolution and evidence, with errored and unexecuted cases counted separately",
      "REST API, MCP server and CLI for release gates",
    ],
  };
}

export interface Crumb { name: string; path: string }

export function breadcrumbLd(crumbs: Crumb[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE_ORIGIN}${c.path}`,
    })),
  };
}

/** A documentation page. `dateModified` is omitted unless a real date is known; no author is invented. */
export function techArticleLd(input: {
  headline: string;
  description?: string;
  path: string;
  dateModified?: string | null;
}): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.headline,
    ...(input.description ? { description: input.description } : {}),
    url: `${SITE_ORIGIN}${input.path}`,
    inLanguage: "en",
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
  };
}

export function collectionPageLd(input: { name: string; description: string; path: string }): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.name,
    description: input.description,
    url: `${SITE_ORIGIN}${input.path}`,
    inLanguage: "en",
  };
}
