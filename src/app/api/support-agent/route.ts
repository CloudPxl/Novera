import { timingSafeEqual } from "node:crypto";
import { MESSAGE_MAX } from "@/lib/support/limits.ts";
import { NextResponse, type NextRequest } from "next/server";
import { serviceClient } from "@/lib/supabase/service.ts";
import { createRoutedChat } from "@/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "@/lib/router/routes.ts";
import { connectionsFromEnv } from "@/lib/providers/registry.ts";
import { checkEscalation, withSources, DEFAULT_HOLDING_LINE } from "@/lib/support/escalate.ts";
import { draftAnswer, type DocPage } from "@/lib/support/answer.ts";

export const maxDuration = 60;

/**
 * Novera's own support agent, exposed so Novera can be run against it.
 *
 * This is the real pipeline, not a copy of it: the same escalation rules, the same
 * corpus, the same drafting function. Testing a reimplementation would prove nothing
 * about what people actually receive.
 *
 * What it returns is what a person would actually get — the drafted answer when there
 * is one, and otherwise the acknowledgement the form shows, because on the escalation
 * path no automatic reply is sent at all.
 *
 * Token-gated: it costs model calls and would otherwise be an open proxy.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.NOVERA_SUPPORT_AGENT_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "This endpoint is not configured." }, { status: 503 });
  }
  // Constant time: `!==` stops at the first differing character, which is a timing
  // signal about how much of a guess was right.
  const given = Buffer.from(request.headers.get("x-novera-support-token") ?? "");
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Send a message." }, { status: 400 });
  }
  // The same ceiling as the public form: every character is paid for in a model call.
  if (message.length > MESSAGE_MAX) {
    return NextResponse.json({ error: `Keep the message under ${MESSAGE_MAX} characters.` }, { status: 413 });
  }

  const escalation = checkEscalation(message);
  if (escalation.escalate) {
    return NextResponse.json({
      reply: escalation.holdingLine ?? DEFAULT_HOLDING_LINE,
      escalated: true,
      citations: [],
    });
  }

  const db = serviceClient();
  const { data: pages } = await db
    .from("doc_pages").select("slug, title, body").eq("published", true).order("slug");

  const drafted = await draftAnswer({
    chat: createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES }),
    question: message,
    pages: (pages ?? []) as DocPage[],
  });

  if (!drafted.answered || !drafted.body) {
    return NextResponse.json({ reply: DEFAULT_HOLDING_LINE, escalated: true, citations: [] });
  }

  return NextResponse.json({
    // Exactly what sendDraft puts in an email, so the graded reply is the sent reply.
    reply: withSources(drafted.body, drafted.citations, process.env.NEXT_PUBLIC_APP_URL),
    escalated: false,
    citations: drafted.citations,
  });
}
