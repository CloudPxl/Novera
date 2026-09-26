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

/**
 * A timestamp that says which clock it is on.
 *
 * These were rendered as a sliced ISO string — UTC, with nothing saying so, on the one
 * screen where "how long has this person been waiting" is the question. An operator in
 * Europe read every one of them an hour or two wrong.
 */
function Stamp({ at, className = "" }: { at: string; className?: string }) {
  const when = new Date(at);
  return (
    <time dateTime={when.toISOString()} className={className}>
      {when.toISOString().slice(0, 16).replace("T", " ")} UTC
    </time>
  );
}

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

  // Counted from the rows on screen, and described by what they are. The line used to
  // read "Nothing here has been sent to anyone", which stopped being true the moment a
  // sent reply appeared in the list underneath it.
  const rows = requests ?? [];
  const waiting = rows.filter((r) => r.status !== "sent").length;
  const sent = rows.length - waiting;

  return (
    <main className="w-full max-w-3xl py-8 text-ink">
      <Link href="/dashboard" className="text-sm text-ink-faint underline-offset-2 hover:underline">
        ← Dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Inbox</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {waiting} waiting on you
        {sent > 0 ? `, ${sent} already sent` : ""}. A draft is never sent until you send it.
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
              <Reveal key={r.id as string} delay={Math.min(i, 8) * 40} as="li">
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
                      <span className="text-sm text-ink-faint">· {r.organisation as string}</span>
                    )}
                    <Stamp at={r.created_at as string} className="ml-auto text-xs text-ink-faint" />
                  </div>

                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-ground px-3 py-2 text-sm leading-relaxed text-ink-soft">
                    {r.message as string}
                  </p>

                  {r.escalation_reason && (
                    <p className="mt-3 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm leading-relaxed text-warning-text">
                      <strong>No draft was written.</strong> {r.escalation_reason as string}
                    </p>
                  )}

                  {current && (
                    <div className="mt-4 rounded-lg border border-line p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={current.status === "sent" ? "neutral" : current.status === "approved" ? "pass" : "live"}>
                          {current.status as string}
                        </Badge>
                        {current.model ? (
                          <span className="font-mono text-[11px] text-ink-faint">
                            drafted by {current.model as string}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-faint">written by hand</span>
                        )}
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                        {current.body as string}
                      </p>

                      {Array.isArray(current.citations) && current.citations.length > 0 && (
                        <p className="mt-3 text-xs text-ink-faint">
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
                        <p role="alert" className="mt-3 rounded-lg border border-fail-border bg-fail-surface px-3 py-2 text-sm text-fail-text">
                          Last send failed: {current.send_error as string}
                        </p>
                      )}

                      <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
                        {current.status === "draft" && <ApproveButton draftId={current.id as string} />}
                        {current.status === "approved" && (
                          <SendButton draftId={current.id as string} to={r.email as string} />
                        )}
                        {current.status === "sent" && (
                          <p className="text-xs text-ink-faint">
                            Sent <Stamp at={current.sent_at as string} />.
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
                      <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-soft">
                        {superseded.length} earlier draft{superseded.length === 1 ? "" : "s"} kept
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {superseded.map((d) => (
                          <li key={d.id as string} className="rounded-lg bg-ground px-3 py-2 text-xs leading-relaxed text-ink-soft">
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
