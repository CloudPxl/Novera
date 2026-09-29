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
