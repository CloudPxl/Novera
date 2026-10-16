import { currentWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { loadComparison, type ComparisonRefusalReason, type LoadedRun } from "@/lib/evidence/comparison-loader.ts";
import {
  buildComparisonExport, buildComparisonRefusal, comparisonFileName, renderComparisonMarkdown, serializeComparisonJson,
  type ExportRun,
} from "@/lib/evidence/comparison-export.ts";
import { obligationLabel } from "@/lib/report/payload.ts";

export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const STATUS: Record<ComparisonRefusalReason, number> = {
  missing: 400, invalid: 400, same_run: 400, not_found: 404, other_workspace: 404, unsettled: 409, different_agent: 409, different_suite: 409, different_locale: 409,
};

const exportRun = (run: LoadedRun, agent: string): ExportRun => ({
  id: run.id,
  status: run.status,
  startedAt: run.startedAt ?? run.createdAt,
  completedAt: run.finishedAt,
  agent,
  suite: {
    name: run.suite.name, key: run.suite.key, version: run.suite.version,
    digest: typeof run.manifest?.suite_digest === "string" ? run.manifest.suite_digest : null,
  },
  seal: run.seal ? { sha256: run.seal.contentHash, sealedAt: run.seal.createdAt, withdrawnAt: run.seal.revokedAt } : null,
});

/**
 * `GET /runs/compare/export?base=&target=&format=md|json`: the comparison page as a download.
 *
 * Signed in and in the workspace both runs belong to, read through the same `loadComparison` as
 * the page and the run page's Comparison tab, so the file can never disagree with the screen. A
 * refusal is a status and a short body in the requested format, never a redirect: `fetch` would
 * read a sign-in page as a 200. Only verdicts, ids, titles and hashes are written (see
 * src/lib/evidence/comparison-export.ts); no reply, input or conversation leaves.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "md" && format !== "json") {
    return Response.json({ error: "format must be md or json." }, { status: 400, headers: HEADERS });
  }
  const session = await currentWorkspace();
  if (!session) return Response.json({ error: "Sign in to download this comparison." }, { status: 401, headers: HEADERS });

  const db = await sessionClient();
  const baseId = url.searchParams.get("base");
  const targetId = url.searchParams.get("target");
  const loaded = await loadComparison({ db, workspaceId: session.workspace.id, baseId, targetId, seals: true });
  const now = new Date();
  const render = (doc: Parameters<typeof serializeComparisonJson>[0]) =>
    format === "json" ? serializeComparisonJson(doc) : renderComparisonMarkdown(doc);
  const type = format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8";

  if (!loaded.ok) {
    const body = render(buildComparisonRefusal({ reason: loaded.reason, sentence: loaded.sentence, now }));
    return new Response(body, { status: STATUS[loaded.reason], headers: { ...HEADERS, "content-type": type } });
  }

  const { base, target, deltas, config } = loaded;
  const [{ data: agent }, { data: suites }] = await Promise.all([
    db.from("agents").select("name").eq("id", target.agentId).maybeSingle(),
    db.from("suites").select("id, cases").in("id", [...new Set([base.suite.id, target.suite.id])]),
  ]);
  const agentName = (agent?.name as string | undefined) ?? "Agent";
  // The target's suite names a scenario last; an id only the base has is titled from the base's.
  const titles = new Map<string, string>();
  const byId = new Map((suites ?? []).map((s) => [s.id as string, s.cases as Array<{ id?: unknown; obligation?: unknown }> | null]));
  for (const suiteId of [base.suite.id, target.suite.id]) {
    for (const c of byId.get(suiteId) ?? []) {
      if (typeof c.id === "string" && typeof c.obligation === "string") titles.set(c.id, obligationLabel(c.obligation));
    }
  }

  const doc = buildComparisonExport({
    base: exportRun(base, agentName), target: exportRun(target, agentName), deltas,
    otherDifferences: config.changes, titles, now,
  });
  return new Response(render(doc), {
    status: 200,
    headers: {
      ...HEADERS,
      "content-type": type,
      "content-disposition": `attachment; filename="${comparisonFileName(base.id, target.id, format)}"`,
    },
  });
}
