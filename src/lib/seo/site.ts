import type { Metadata } from "next";

/** The one address production answers on (src/proxy.ts redirects every other host here). */
export const SITE_ORIGIN = "https://www.nover.space";
export const SITE_NAME = "Novera";
export const DEFAULT_TITLE = "Novera — EU AI Act & agent evaluation";
export const TITLE_TEMPLATE = "%s | Novera — EU AI Act & Agent Evaluation";
export const DEFAULT_DESCRIPTION =
  "Run a versioned scenario suite against an AI support agent you operate and produce a dated, hash-sealed report: testing evidence mapped to the EU AI Act and GDPR duties you already have to document.";

/** The card image for a page: `/api/og?title=…` (relative; resolved against `metadataBase`). */
export function ogImageUrl(title: string): string {
  return `/api/og?title=${encodeURIComponent(title)}`;
}

/**
 * The metadata every public page shares: description, a canonical path, and Open Graph and
 * Twitter cards with a generated image. A page's own `openGraph` replaces the layout's wholesale
 * (Next merges shallowly), so the site name, type and locale are repeated here on purpose.
 * `title` is the page's own title; the layout template adds the site name.
 */
export function pageMetadata(input: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  /** Title shown on the card, when it should differ from the page title. */
  cardTitle?: string;
  index?: boolean;
}): Metadata {
  const image = ogImageUrl(input.cardTitle ?? input.title);
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    ...(input.index === false ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title: input.title,
      description: input.description,
      url: input.path,
      siteName: SITE_NAME,
      type: input.type ?? "website",
      locale: "en_GB",
      images: [{ url: image, width: 1200, height: 630, alt: input.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [image],
    },
  };
}
