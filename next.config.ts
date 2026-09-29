import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Advertising the framework and its version helps nobody but someone matching it
  // against a list of known issues.
  poweredByHeader: false,

  // Pages get their headers from `src/proxy.ts`, which does not run for /api. Route
  // handlers answer with data — JSON, CSV, Markdown, JUnit — never with a page, so they
  // get the strictest set: nothing may be sniffed into something executable, framed,
  // or loaded from them. Measured missing on production 2026-09-29.
  async headers() {
    return [
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
