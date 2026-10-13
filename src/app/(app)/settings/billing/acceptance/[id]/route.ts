import { requireWorkspace } from "@/lib/auth/session.ts";
import { can } from "@/lib/auth/permissions.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { acceptanceById, acceptanceReceipt } from "@/lib/legal/acceptance-store.ts";

/**
 * The downloadable record of a contract acceptance (legal build brief §20.1), for the active
 * workspace's owner, admins and auditors — the roles 0068's read policy names. Plain text,
 * generated from the stored row, which cannot be edited.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { workspace, role } = await requireWorkspace();
  if (!can(role, "billing.manage") && role !== "auditor") return new Response("Not found.", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });
  const row = await acceptanceById(serviceClient(), workspace.id, id);
  if (!row) return new Response("Not found.", { status: 404 });
  return new Response(acceptanceReceipt(row, workspace.name), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="novera-acceptance-${row.accepted_at.slice(0, 10)}-${row.id.slice(0, 8)}.txt"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
