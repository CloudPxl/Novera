import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { ApproveButton, SendButton, CloseButton, DraftEditor, EraseButton } from "./client.tsx";

export const metadata: Metadata = { title: "Inbox · Novera" };
export const dynamic = "force-dynamic";

const TONE = {
  new: "live",
  drafted: "live",
  approved: "pass",
  sent: "neutral",
  escalated: "error",
  closed: "neutral",
} as const;

export default async function InboxPage() {
  await requireStaff();
  const db = serviceClient();

  const { data: requests } = await db
    .from("inbound_requests")
    .select("id, kind, email, organisation, message, status, escalation_reason, created_at")
    .not("status", "eq", "closed")
    .order("created_at", { ascending: false })
    .limit(50);

  const ids = (requests ?? []).map((r) => r.id as string);
  const { data: drafts } = ids.length
    ? await db
        .from("reply_drafts")
        .select("id, request_id, body, citations, model, status, approved_at, sent_at, send_error, created_at")
        .in("request_id", ids)
        .order("created_at", { ascending: false })
    : { data: null };

  const draftsByRequest = new Map<string, NonNullable<typeof drafts>>();
  for (const d of drafts ?? []) {
    const list = draftsByRequest.get(d.request_id as string) ?? [];
    list.push(d);
    draftsByRequest.set(d.request_id as string, list);
  }

  const waiting = (requests ?? []).filter((r) => r.status !== "sent").length;

  return (
    <main className="mx-auto w-full max-w-3xl bg-white px-6 py-10 text-slate-900 sm:px-8">
      <Link href="/dashboard" className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Inbox</h1>
      <p className="mt-1 text-sm text-slate-600">
        {waiting} waiting on you. Nothing here has been sent to anyone.
      </p>

      {(requests ?? []).length === 0 ? (
        <div className="mt-8">
          <EmptyState title="Nothing waiting">
            Questions from the support form and trial applications arrive here.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {(requests ?? []).map((r, i) => {
            const forRequest = draftsByRequest.get(r.id as string) ?? [];
            const current = forRequest[0];
            const superseded = forRequest.slice(1);

            return (
              <Reveal key={r.id as string} delay={Math.min(i, 8) * 40}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[r.status as keyof typeof TONE] ?? "neutral"}>
                      {r.status as string}
                    </Badge>
                    <Badge tone="neutral">
                      {r.kind === "support" ? "support" : "trial application"}
                    </Badge>
                    <span className="text-sm font-medium">{r.email as string}</span>
                    {r.organisation && (
                      <span className="text-sm text-slate-500">· {r.organisation as string}</span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(r.created_at as string).toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  </div>

                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
                    {r.message as string}
                  </p>

                  {r.escalation_reason && (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900">
                      <strong>No draft was written.</strong> {r.escalation_reason as string}
                    </p>
                  )}

                  {current && (
                    <div className="mt-4 rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={current.status === "sent" ? "neutral" : current.status === "approved" ? "pass" : "live"}>
                          {current.status as string}
                        </Badge>
                        {current.model ? (
                          <span className="font-mono text-[11px] text-slate-400">
                            drafted by {current.model as string}
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">written by hand</span>
                        )}
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                        {current.body as string}
                      </p>

                      {Array.isArray(current.citations) && current.citations.length > 0 && (
                        <p className="mt-3 text-xs text-slate-500">
                          Rests on:{" "}
                          {(current.citations as string[]).map((slug, n) => (
                            <span key={slug}>
                              {n > 0 && ", "}
                              <Link href={`/docs/${slug}`} className="underline underline-offset-2">
                                {slug}
                              </Link>
                            </span>
                          ))}
                        </p>
                      )}

                      {current.send_error && (
                        <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                          Last send failed: {current.send_error as string}
                        </p>
                      )}

                      <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4">
                        {current.status === "draft" && <ApproveButton draftId={current.id as string} />}
                        {current.status === "approved" && (
                          <SendButton draftId={current.id as string} to={r.email as string} />
                        )}
                        {current.status === "sent" && (
                          <p className="text-xs text-slate-500">
                            Sent{" "}
                            {new Date(current.sent_at as string).toISOString().slice(0, 16).replace("T", " ")}.
                          </p>
                        )}
                        {current.status !== "sent" && (
                          <DraftEditor requestId={r.id as string} seed={current.body as string} />
                        )}
                      </div>
                    </div>
                  )}

                  {!current && (
                    <div className="mt-4">
                      <DraftEditor requestId={r.id as string} seed="" />
                    </div>
                  )}

                  {superseded.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                        {superseded.length} earlier draft{superseded.length === 1 ? "" : "s"} kept
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {superseded.map((d) => (
                          <li key={d.id as string} className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                            {d.body as string}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <CloseButton requestId={r.id as string} />
                    <EraseButton requestId={r.id as string} />
                  </div>
                </Card>
              </Reveal>
            );
          })}
        </ul>
      )}
    </main>
  );
}
