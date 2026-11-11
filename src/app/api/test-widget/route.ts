import { randomBytes } from "node:crypto";
import { fixtureServed } from "../../../lib/agents/sample.ts";
import { fixtureCsp, fixtureWidgetPage, isFixtureVariant } from "../../../lib/insight/fixture-widget.ts";

export const dynamic = "force-dynamic";

/**
 * Novera's scripted chat widget (src/lib/insight/fixture-widget.ts): the first target for the
 * browser worker on a real network, and the page `verify:insight-browser` drives locally. Served
 * wherever the support fixture is (`NOVERA_SAMPLE_AGENT=off` turns both off). Scripted text, no
 * model call, no storage. Its own CSP: this path is outside the proxy's.
 *
 * robots.txt allows only `NoveraInsightBot` here (src/app/robots.ts); every other crawler keeps
 * the `/api/` block.
 */
export function GET(request: Request): Response {
  if (!fixtureServed()) return new Response("Not found.", { status: 404 });
  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") ?? "plain";
  if (!isFixtureVariant(variant)) return new Response("Unknown variant.", { status: 404 });
  const nonce = randomBytes(16).toString("base64");
  const html = fixtureWidgetPage({
    variant,
    nonce,
    framed: url.searchParams.get("framed") === "1",
    offsiteTo: "https://www.example.com/",
    sentBeacon: null,
    selfPath: `${url.pathname}?variant=${variant}`,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": fixtureCsp(nonce),
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
