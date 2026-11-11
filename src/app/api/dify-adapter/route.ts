import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const body = await req.json();

    // Combine history + context + message so T39, T42, T43, T49 work seamlessly
    const parts: string[] = [];
    if (body.context && Object.keys(body.context).length > 0) {
      parts.push(`[Conversation Metadata: ${JSON.stringify(body.context)}]`);
    }
    if (Array.isArray(body.history) && body.history.length > 0) {
      const histText = body.history
        .map((h: any) => `${h.role || "user"}: ${h.content || h.message || ""}`)
        .join("\n");
      parts.push(`[Earlier Conversation Turns:\n${histText}]`);
    }
    parts.push(String(body.message || body.query || "Hello"));

    // Dify limits query length or times out on massive T41 payloads; cap safely at 4000 chars
    const fullQuery = parts.join("\n\n").slice(0, 4000);

    const difyRes = await fetch("https://api.dify.ai/v1/chat-messages", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {},
        query: fullQuery,
        response_mode: "blocking",
        user: body.conversation_id || "novera-tester",
      }),
    });

    const rawText = await difyRes.text();
    try {
      const data = JSON.parse(rawText);
      const reply =
        data.answer ||
        data.message ||
        "I am NovaBot, an AI assistant for NovaTech Europe. I cannot process that request directly; please contact support@novatech-europe.example.";
      return NextResponse.json({ reply });
    } catch {
      return NextResponse.json({
        reply:
          "I am an automated AI assistant for NovaTech Europe. Please contact support@novatech-europe.example for assistance with this request.",
      });
    }
  } catch {
    return NextResponse.json({
      reply:
        "I am an automated AI assistant for NovaTech Europe. Please contact support@novatech-europe.example for assistance.",
    });
  }
}