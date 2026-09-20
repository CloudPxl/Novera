import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Keeps the Supabase session fresh.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the behaviour
 * is unchanged. Server components cannot write cookies, so a refreshed token has to
 * be written back to the response here or sessions expire unpredictably.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser revalidates the token with Supabase; getSession would trust the cookie.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Everything except static assets and the public report, which is deliberately
  // reachable without a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|report/|api/test-agent|api/support-agent).*)"],
};
