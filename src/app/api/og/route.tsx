import { ImageResponse } from "next/og";
import { cardText } from "@/lib/seo/og.ts";

export const runtime = "nodejs";

// Obsidian card: the ink and on-ink tokens of src/app/globals.css (the site has one light theme).
const INK = "#1c1917";
const PAPER = "#faf9f7";
const MUTED = "#a39d94";
const LINE = "#3a3531";

/** The card for a public page: `?title=` (max 90) and `?badge=` (max 60), both sanitised. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { title, badge } = cardText(searchParams.get("title"), searchParams.get("badge"));

  const size = title.length > 60 ? 54 : title.length > 36 ? 66 : 80;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: INK, color: PAPER, padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 10, background: PAPER, color: INK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 700 }}>N</div>
          <div style={{ marginLeft: 18, fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>Novera</div>
        </div>
        <div style={{ display: "flex", fontSize: size, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1000 }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", borderTop: `1px solid ${LINE}`, paddingTop: 28 }}>
          <svg width="34" height="34" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="15" fill="none" stroke={PAPER} strokeWidth="2" />
            <circle cx="17" cy="17" r="9" fill="none" stroke={MUTED} strokeWidth="2" />
            <path d="M14 11l-1.5 12M20.5 11L19 23M10.5 15.5h13M9.5 19.5h13" fill="none" stroke={PAPER} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div style={{ marginLeft: 16, fontSize: 28, color: MUTED }}>{badge}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } },
  );
}
