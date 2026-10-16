import { authenticateApiKey } from "@/lib/api/auth.ts";
import { apiJson, reportUrl } from "@/lib/api/respond.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { loadCiRun } from "@/lib/ci/server.ts";
import { reportToJunit, unsealedRunJunit } from "@/lib/report/export.ts";
import type { ReportPayload } from "@/lib/report/payload.ts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JUnit when asked for with `?format=junit`, or by an `Accept` that names XML and not JSON. */
function wantsJunit(request: Request, url: URL): boolean {
  const format = url.searchParams.get("format");
  if (format) return format === "junit";
  const accept = request.headers.get("accept") ?? "";
  return /\b(?:application|text)\/xml\b/i.test(accept) && !/application\/json/i.test(accept);
}

/**
 * A run as a CI gate reads it: the exit code (0 pass · 1 fail · 2 incomplete ·
 * 3 configuration · 4 infrastructure; null while it runs), why, the seal, the suite digest
 * and the comparison with the previous comparable run. Needs the `read` scope.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, "read");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  // The same answer for a malformed id and for another workspace's run.
  if (!UUID.test(id)) return apiJson({ error: "No such run in this workspace." }, 404);
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== null && format !== "json" && format !== "junit") {
    return apiJson({ error: "`format` must be json or junit." }, 400);
  }

  const ci = await loadCiRun(serviceClient(), auth.caller.workspaceId, id, url.origin);
  if (!ci) return apiJson({ error: "No such run in this workspace." }, 404);

  const report = ci.report
    ? {
        content_hash: ci.report.content_hash,
        url: reportUrl(url.origin, ci.report.token),
        verify_url: `${url.origin}/verify/${ci.report.content_hash}`,
      }
    : null;

  if (wantsJunit(request, url)) {
    const extras: Array<readonly [string, string | number]> = [
      ["novera.suite_digest", ci.suite_digest ?? "not recorded for this run"],
      ...(ci.baseline_comparison
        ? [["novera.compare_url", ci.baseline_comparison.compare_url] as const, ["novera.baseline", ci.baseline_comparison.summary] as const]
        // Compared only once a run completes; before that there is nothing to say about it.
        : ci.run.status === "completed" ? [["novera.compare_url", "no earlier comparable run"] as const] : []),
      ...(ci.run.git_commit_sha ? [["novera.git_commit_sha", ci.run.git_commit_sha] as const] : []),
    ];
    const xml = ci.report && ci.exit.code !== null && report
      ? reportToJunit(ci.report.payload as ReportPayload, ci.report.content_hash, report.url, {
          properties: [["novera.report_seal", ci.report.content_hash], ["novera.verify_url", report.verify_url], ...extras],
        })
      : unsealedRunJunit({ id: ci.run.id, status: ci.run.status, suite: ci.run.suite, exitCode: ci.exit.code, reason: ci.exit.reason, properties: extras });
    return new Response(xml, {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `inline; filename="novera-${ci.run.id}.junit.xml"`,
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  return apiJson({
    run: ci.run,
    ci_exit_code: ci.exit.code,
    ci_exit_reason: ci.exit.reason,
    report,
    suite_digest: ci.suite_digest,
    baseline_comparison: ci.baseline_comparison,
  });
}
