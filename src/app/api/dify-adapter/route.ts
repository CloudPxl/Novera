import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

/**
 * A relay from Novera's default request shape to Dify's chat-messages API, written on
 * 2026-11-11 to get one Dify agent connected.
 *
 * Deprecated: Novera now speaks Dify's API itself ("Connect an agent" → Start from → Dify), with
 * its own conversation ids and streamed replies, so an agent should point at Dify directly and
 * this route should then be deleted. It stays only so the agent connected through it keeps
 * answering until its connection is changed.
 *
 * What it must never do is answer for the agent. An earlier version returned a canned sentence
 * whenever Dify failed or answered without text; Novera then graded that sentence as the agent's
 * reply and sealed it into a report. A failure upstream is passed on as a failure, with the
 * status Dify gave, so the scenario is recorded as having no reply — which is what happened.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "The request body was not JSON." }, { status: 400 });
  }
  const authHeader = req.headers.get("authorization") || "";

  const parts: string[] = [];
  const context = body.context;
  if (context && typeof context === "object" && Object.keys(context).length > 0) {
    parts.push(`[Conversation Metadata: ${JSON.stringify(context)}]`);
  }
  if (Array.isArray(body.history) && body.history.length > 0) {
    const histText = (body.history as Array<{ role?: string; content?: string; message?: string }>)
      .map((h) => `${h.role || "user"}: ${h.content || h.message || ""}`)
      .join("\n");
    parts.push(`[Earlier Conversation Turns:\n${histText}]`);
  }
  const message = typeof body.message === "string" ? body.message : typeof body.query === "string" ? body.query : "";
  if (!message) return NextResponse.json({ error: "The request carried no message." }, { status: 400 });
  parts.push(message);

  let difyRes: Response;
  try {
    difyRes = await fetch("https://api.dify.ai/v1/chat-messages", {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: {},
        query: parts.join("\n\n"),
        response_mode: "blocking",
        user: typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id : "novera-tester",
      }),
    });
  } catch {
    return NextResponse.json({ error: "Dify could not be reached." }, { status: 502 });
  }

  const rawText = await difyRes.text();
  let data: { answer?: unknown } | null = null;
  try {
    data = JSON.parse(rawText) as { answer?: unknown };
  } catch {
    data = null;
  }
  if (!difyRes.ok) {
    return NextResponse.json({ error: `Dify answered HTTP ${difyRes.status}.` }, { status: difyRes.status });
  }
  if (!data || typeof data.answer !== "string") {
    return NextResponse.json({ error: "Dify answered without an answer field." }, { status: 502 });
  }
  return NextResponse.json({ reply: data.answer });
}
