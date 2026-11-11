import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "../lib/seo/site.ts";

/**
 * What crawlers may read: the public pages. The operator app, client reports, invitations and
 * the API are behind sign-in or a private token and say `noindex` themselves; listing them here
 * keeps crawlers from spending requests on redirects. `/legal` stays crawlable so its
 * `noindex` is seen — a disallowed page cannot be read, and so cannot be dropped. The
 * explicit Allow lines are longer than `/api/`, and the longest matching rule wins, so the
 * card image, the OpenAPI document and llms.txt stay reachable beside the blocked API.
 */
const ALLOW = ["/", "/docs", "/solutions", "/verify", "/legal", "/api/og", "/llms.txt", "/api/v1/openapi.json"];
const DISALLOW = [
  "/api/", "/auth/", "/report/", "/invite/", "/reset-password", "/sign-in",
  "/dashboard", "/agents", "/runs/", "/runs", "/reports", "/review", "/scenarios", "/regressions",
  "/builder", "/workspaces", "/settings/", "/settings", "/inbox", "/readiness", "/insight", "/welcome",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: ALLOW, disallow: DISALLOW },
      // Novera's own browser worker (src/lib/insight/protocol.ts, /bot) honours robots.txt like any
      // crawler. A bot with its own group ignores the `*` group, so this one repeats it and adds the
      // scripted chat widget it is tested against (/api/test-widget), longer than "/api/".
      { userAgent: "NoveraInsightBot", allow: [...ALLOW, "/api/test-widget"], disallow: DISALLOW },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
