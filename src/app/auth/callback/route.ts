import type { NextRequest } from "next/server";
import { completeAuth, flowOf } from "./handle.ts";

/** The return address for every Supabase link that carries a `code`. See ./handle.ts. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  return completeAuth(url, flowOf(url.searchParams.get("flow")));
}
