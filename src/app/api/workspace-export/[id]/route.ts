import { createHash } from "node:crypto";
import { currentWorkspace, gate } from "@/lib/auth/session.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { loadExportSource } from "@/lib/export/load.ts";
import { buildWorkspaceExport, serializeExport, type WorkspaceExport } from "@/lib/export/workspace.ts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_STORE = {
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/** Refusals in JSON with a status, never a redirect: `fetch` would read a sign-in page as a 200. */
function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

/**
 * The one download of a workspace export (0061).
 *
 * Who: signed in, the person who asked for it, still owner or admin of the workspace (checked
 * against the live membership row), with that workspace active. Another workspace's export
 * answers exactly like one that does not exist.
 * When: once, before the receipt's `expires_at`. The receipt moves pending → ready in one
 * conditional update, which also refuses an expired row in the database, so two tabs racing
 * get one file.
 * What: built now, from stored rows, for this workspace only. The receipt records the SHA-256,
 * size and row counts of exactly the bytes sent, and the audit trail records the download
 * before a byte leaves.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await currentWorkspace();
  if (!session) return refuse("Sign in to download this export.", 401);
  const { user, workspace } = session;
  const gated = await gate(user.id, workspace.id, "workspace.export");
  if ("error" in gated) return refuse(gated.error, 403);
  const db = gated.admin;

  const { id } = await ctx.params;
  if (!UUID.test(id)) return refuse("No such export in this workspace.", 404);
  const { data: job } = await db.from("workspace_exports")
    .select("id, workspace_id, requested_by, status, includes_raw_evidence, expires_at")
    .eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!job) return refuse("No such export in this workspace. If you switched workspace, switch back and use the link again.", 404);
  if (job.requested_by !== user.id) return refuse("Only the person who asked for this export can download it.", 403);
  if (job.status === "ready") return refuse("This export was already downloaded. Ask for a new one under Settings.", 410);
  if (job.status !== "pending") return refuse(`This export is ${job.status as string}. Ask for a new one under Settings.`, 410);
  if (Date.parse(job.expires_at as string) <= Date.now()) {
    await db.from("workspace_exports").update({ status: "expired" }).eq("id", id).eq("status", "pending");
    return refuse("This export link expired. Ask for a new one under Settings.", 410);
  }

  let body: string;
  let doc: WorkspaceExport;
  try {
    const source = await loadExportSource(db, workspace.id, { includeRawEvidence: job.includes_raw_evidence === true });
    doc = buildWorkspaceExport(source, {
      exportId: id, exportedAt: new Date().toISOString(), exportedBy: user.id, includeRawEvidence: job.includes_raw_evidence === true,
    });
    body = serializeExport(doc);
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await db.from("workspace_exports").update({ status: "failed", error: message }).eq("id", id).eq("status", "pending");
    return refuse(`The export could not be built: ${message}`, 500);
  }

  const bytes = new TextEncoder().encode(body);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { data: claimed, error: claimError } = await db.from("workspace_exports")
    .update({ status: "ready", sha256, byte_size: bytes.byteLength, row_counts: doc.counts, delivered_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").select("id");
  if (claimError) {
    return /expired/i.test(claimError.message)
      ? refuse("This export link expired. Ask for a new one under Settings.", 410)
      : refuse(`The export could not be recorded, so it was not sent: ${claimError.message}`, 500);
  }
  if (!claimed?.length) return refuse("This export was already downloaded. Ask for a new one under Settings.", 410);

  const rows = Object.values(doc.counts).reduce((a, b) => a + b, 0);
  // Thrown on failure: data does not leave unrecorded.
  await recordAudit(db, {
    workspaceId: workspace.id, actorId: user.id, action: "workspace.exported",
    detail: { export: id, raw_evidence: job.includes_raw_evidence === true, sha256, bytes: bytes.byteLength, rows },
  });

  const slug = workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
  const filename = `novera-workspace-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  // Streamed in chunks, so a large workspace is not held to a single response body.
  const CHUNK = 64 * 1024;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + CHUNK));
      offset += CHUNK;
    },
  });
  return new Response(stream, {
    headers: {
      ...NO_STORE,
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(bytes.byteLength),
      "x-novera-export-sha256": sha256,
    },
  });
}
