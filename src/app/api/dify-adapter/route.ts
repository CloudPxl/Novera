import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const body = await req.json();
    const message = body.message || body.query || "";

    const difyRes = await fetch("https://api.dify.ai/v1/chat-messages", {
      method: "POST",
      headers: {
        "Authorization": authHeader || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {},
        query: message,
        response_mode: "blocking",
        user: "novera-tester",
      }),
    });

    const data = await difyRes.json();
    return NextResponse.json({ reply: data.answer || "No response" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}