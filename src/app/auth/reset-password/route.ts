import { NextResponse, type NextRequest } from "next/server";
import { resetLinkTarget } from "@/lib/auth/reset-links.ts";

/** A reset link's other address, forwarded to the handler that spends it (src/lib/auth/reset-links.ts). */
export function GET(request: NextRequest) {
  const url = new URL(request.url);
  return NextResponse.redirect(new URL(resetLinkTarget(url), url.origin), 307);
}
