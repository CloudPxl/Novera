import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Advertising the framework and its version helps nobody but someone matching it
  // against a list of known issues.
  poweredByHeader: false,

  // A Suite Builder source may be a 2 MB document (src/lib/builder/sources.ts checks the
  // bytes again); the default 1 MB would refuse it before that check could explain why.
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
  },

  // The dev server prints every request URL, and an auth return address carries a one-time
  // code or token in its query string. Single-use and spent on arrival, but a terminal log
  // is shared and pasted; those two routes are not printed. (Development only: production
  // logs no request lines of ours.)
  logging: {
    incomingRequests: { ignore: [/^\/auth\/(callback|confirm)/] },
  },

  // Pages get their headers from `src/proxy.ts`, which does not run for /api. Route
  // handlers answer with data — JSON, CSV, Markdown, JUnit — never with a page, so they
  // get the strictest set: nothing may be sniffed into something executable, framed,
  // or loaded from them. Measured missing on production 2026-09-29.
  async headers() {
    return [
      // The legal pages are drafts for counsel. The page metadata says noindex; the header
      // says it to crawlers that read only headers. Remove both when a document is signed off.
      { source: "/legal", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/legal/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
