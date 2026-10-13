import { registerSnapshot } from "../../../../data/legal/register.ts";

/**
 * The provider register, machine-readable (legal build brief §20.6). Whether each provider is
 * in use is read from this deployment's configuration — never a value, only whether it is set.
 * Not indexed while the register is a draft.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(registerSnapshot(), {
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" },
  });
}
