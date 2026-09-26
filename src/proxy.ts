import { NextResponse, type NextRequest } from "next/server";

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

export function proxy(request: NextRequest) {
  const host = request.headers.get("host");
  if (process.env.VERCEL_ENV === "production" && host && host !== CANONICAL_HOST) {
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${CANONICAL_HOST}`);
    return NextResponse.redirect(target, 308);
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
    "form-action 'self'",
    // A report is a document someone was sent, not a widget. It is never framed.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

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
