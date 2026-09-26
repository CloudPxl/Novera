import { loadReportByToken } from "@/lib/report/access.ts";
import { reportToCsv, reportToJson, reportToJunit, reportToMarkdown } from "@/lib/report/export.ts";

export const dynamic = "force-dynamic";

/**
 * A sealed report, as a file.
 *
 * It goes through `loadReportByToken`, the same gate the public page uses, so an
 * export stops working the moment a link is revoked or expires. That is the whole
 * promise revocation makes, and a second copy of the rule here would eventually
 * break it.
 *
 * PDF is deliberately absent. The report page already prints correctly, so
 * browser print-to-PDF produces the same document for free — a server-side PDF
 * dependency would add real weight to a near-zero-cost stack to duplicate
 * something that works.
 */
const TYPES = {
  md: { extension: "md", contentType: "text/markdown; charset=utf-8" },
  csv: { extension: "csv", contentType: "text/csv; charset=utf-8" },
  // The sealed payload with its hash, for independent verification and the CLI.
  json: { extension: "json", contentType: "application/json; charset=utf-8" },
  junit: { extension: "xml", contentType: "application/xml; charset=utf-8" },
} as const;

type Format = keyof typeof TYPES;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "agent";
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") ?? "md";

  if (!Object.hasOwn(TYPES, format)) {
    return new Response("Unsupported format. Use md, csv, json or junit.", { status: 400 });
  }

  const result = await loadReportByToken(token);
  if (result === null) return new Response("No such report.", { status: 404 });
  if (result === "revoked") return new Response("This report has been withdrawn.", { status: 410 });
  if (result === "expired") return new Response("This report link has expired.", { status: 410 });

  const { payload, content_hash } = result;
  const origin = new URL(request.url).origin;
  const url = `${origin}/report/${token}`;
  const render: Record<Format, () => string> = {
    md: () => reportToMarkdown(payload, content_hash, url),
    csv: () => reportToCsv(payload, content_hash),
    json: () => reportToJson(payload, content_hash, url),
    junit: () => reportToJunit(payload, content_hash, url),
  };
  const body = render[format as Format]();

  const { extension, contentType } = TYPES[format as Format];
  const name = `novera-report-${slug(payload.subject.agent)}-${payload.run.date.slice(0, 10)}.${extension}`;

  return new Response(body, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${name}"`,
      // The link is the access control, so a copy must not be cached by anything
      // between us and the reader, and must never be indexed.
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
