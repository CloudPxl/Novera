import { ImageResponse } from "next/og";
import { LOGO_BARS } from "@/components/ui/logo.tsx";

// The home-screen icon: the logomark in its own colours. A home screen has no theme to follow,
// so the tile carries its background with it.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#09090b" }}>
        <svg width="180" height="180" viewBox="0 0 100 100">
          {LOGO_BARS.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} fill="#e5e7eb" />)}
        </svg>
      </div>
    ),
    size,
  );
}
