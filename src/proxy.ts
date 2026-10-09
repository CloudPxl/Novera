import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * The headers every page is served with.
 *
 * Until now `next.config.ts` was the default stub: no CSP, no frame policy, no
 * referrer policy. A sealed client report — a document whose only access control is
 * that the link is unguessable — could be framed inside any page on the internet, and
 * an injected script would have had nothing standing in its way.
 *
 * This is `proxy.ts`, not `middleware.ts`: Next 16 renamed the file convention and the
 * exported function. Written from `node_modules/next/dist/docs/01-app/02-guides/
 * content-security-policy.md` rather than from memory, which is the whole reason
 * AGENTS.md says to read it.
 *
 * The CSP is nonce-based, so it needs no `'unsafe-inline'` for scripts. Next extracts
 * the nonce from this header during server rendering and attaches it to the framework
 * and page bundles itself — which is also why every page it covers must be dynamically
 * rendered: a page built at build time has no request to take a nonce from.
 */
/**
 * The one address production answers on. Vercel also serves every production build on
 * `*.vercel.app` aliases, which put a second copy of the site — sign-in included — at an
 * address nobody was told about, with its own cookies. Only production is redirected:
 * a preview deployment exists to be looked at on its own URL.
 */
const CANONICAL_HOST = process.env.CANONICAL_HOST ?? "www.nover.space";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (process.env.VERCEL_ENV === "production" && host && host !== CANONICAL_HOST) {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${CANONICAL_HOST}`);
    return NextResponse.redirect(target, 308);
  }

  // Supabase sends an emailed link to its Site URL root instead of `/auth/callback` when the
  // callback is missing from its redirect allow list — a dashboard setting, outside this
  // repository. The home page ignores a `code`, so the person landed signed out with no word
  // about their confirmation. Forwarded rather than handled twice; treated as a sign-up.
  if (request.nextUrl.pathname === "/" && (request.nextUrl.searchParams.has("code") || request.nextUrl.searchParams.has("error_code"))) {
    const target = new URL("/auth/callback", request.nextUrl.origin);
    for (const key of ["code", "error", "error_code", "error_description"]) {
      const value = request.nextUrl.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    target.searchParams.set("flow", "signup");
    return NextResponse.redirect(target, 307);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // The browser client talks to Supabase directly from the run page, which is what
  // makes a live run update without polling our own server. Named explicitly rather
  // than opened to https:, so a script that did get in could not exfiltrate anywhere.
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const csp = [
    "default-src 'self'",
    // `'unsafe-eval'` in development only: React uses eval there to rebuild
    // server-side error stacks in the browser. Neither React nor Next needs it in
    // production, so production does not get it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Development only: the dev server injects its own <style> tags without a nonce,
    // which logged ~33 refusals on every page and buried real errors. A browser ignores
    // 'unsafe-inline' whenever a nonce is present, so dev omits the nonce for styles.
    // Production is unchanged.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // Progress bars and the reveal animation set a width or a delay as an attribute.
    // `style-src-attr` is the narrow permission for exactly that, and it does not
    // allow a `<style>` block or an external sheet.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    // Fonts are self-hosted by next/font at build time; nothing is fetched at runtime.
    "font-src 'self'",
    `connect-src 'self'${supabase ? ` ${supabase}` : ""}${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    // "Continue with Google/GitHub" is a form whose answer redirects to Supabase, which
    // redirects to the provider; browsers hold the whole redirect chain of a submission to
    // form-action. Named hosts only, the same three the sign-in can lead to.
    `form-action 'self'${supabase ? ` ${supabase}` : ""} https://accounts.google.com https://github.com`,
    // A report is a document someone was sent, not a widget. It is never framed.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  // Keep the Supabase session fresh. Server components cannot write cookies, so a
  // token refreshed during render was never saved: the browser kept presenting a
  // refresh token Supabase had already spent, Supabase read that as reuse and ended
  // the session — everyone was signed out about an hour after signing in. This lived
  // here until the Phase 6A rewrite dropped it (2026-09-24).
  //
  // Refreshed first, and written onto the request as well as the response, so the
  // page rendering *this* request reads the new token rather than spending the old
  // one a second time. Skipped when there is no session cookie at all: a stranger
  // reading a report should not cost an auth round trip.
  const refreshed: Array<{ name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] }> = [];
  if (request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (toSet) => {
            for (const cookie of toSet) {
              request.cookies.set(cookie.name, cookie.value);
              refreshed.push(cookie);
            }
          },
        },
      },
    );
    // getUser revalidates with Supabase; getSession would trust the cookie as sent.
    await supabase.auth.getUser();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Where the person was going, so a signed-out redirect to /sign-in can bring them back
  // (`requireUser`). Path only; it is checked against a fixed list there (`safeNext`).
  requestHeaders.set("x-novera-path", request.nextUrl.pathname);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const { name, value, options } of refreshed) response.cookies.set(name, value, options);

  response.headers.set("Content-Security-Policy", csp);
  // Belt and braces with frame-ancestors, for anything that does not read CSP.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  // A report token lives in the path. Sending it to another origin in a Referer header
  // would hand the link to whoever the reader clicks through to next.
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );

  return response;
}

export const config = {
  matcher: [
    {
      // API routes set their own headers — the export route already sends `no-store`
      // and `noindex`, which a blanket rule here would be at risk of contradicting.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
