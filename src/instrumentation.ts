/**
 * Measurement hook, off by default.
 *
 * With `NOVERA_QUERY_LOG=1`, every request the server makes to Supabase is printed as
 * one `[q]` line. Next prints each page request after it finishes, so the `[q]` lines
 * above a page's line are what that page cost. That is how the query budgets in
 * docs/DECISIONS.md were measured, and how to check one after changing a page: an N+1
 * reads as the same table repeated once per row.
 *
 * Nothing is registered unless the variable is set, and never in production.
 * (Error reporting, below, is separate and always on.)
 */
export function register() {
  if (process.env.NOVERA_QUERY_LOG !== "1") return;
  if (process.env.NODE_ENV === "production" || process.env.NEXT_RUNTIME !== "nodejs") return;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!base || !url.startsWith(base)) return original(input, init);
    const started = Date.now();
    const response = await original(input, init);
    const path = url.slice(base.length).split("?")[0];
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    console.log(`[q] ${method} ${path} ${response.status} ${Date.now() - started}ms`);
    return response;
  };
}

/**
 * Every error Next captures on the server — a page render, a route handler, a server
 * action, the proxy — reported once, scrubbed (src/lib/observability). A structured
 * `[novera:error]` console line always; a vendor only when one is configured
 * (docs/setup/monitoring.md). The request's headers, query and body never leave: the event
 * is built from an allow list, so a report token in the path, a cookie or a customer's key
 * in a header cannot reach a log by being part of the error.
 *
 * Awaited, as Next asks, and bounded: a vendor call has a three-second deadline.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: Record<string, unknown>,
): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME === "edge") {
      // Nothing runs on the edge runtime today; if something does, it gets the console line.
      const { scrubEvent } = await import("./lib/observability/scrub.ts");
      console.error(`[novera:error] ${JSON.stringify(scrubEvent({ error, request, context, environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV }))}`);
      return;
    }
    const { captureError } = await import("./lib/observability/capture.ts");
    await captureError(error, { request, context });
  } catch {
    // Reporting must never become a second failure.
  }
}
