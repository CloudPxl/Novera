import type { MetadataRoute } from "next";

/**
 * What crawlers may read: the public pages. The operator app, client reports, invitations and
 * the API are behind sign-in or a private token and say `noindex` themselves; listing them here
 * keeps crawlers from spending requests on redirects. `/legal` stays crawlable so its
 * `noindex` is seen — a disallowed page cannot be read, and so cannot be dropped.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/", "/auth/", "/report/", "/invite/", "/reset-password",
        "/dashboard", "/agents", "/runs", "/reports", "/review", "/scenarios", "/regressions",
        "/builder", "/workspaces", "/settings", "/inbox", "/welcome",
      ],
    },
    sitemap: "https://www.nover.space/sitemap.xml",
  };
}
