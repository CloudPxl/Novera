import type { Category } from "@/lib/insight/types.ts";

/** Badge tones for a target's category: a scale from scannable to never, not verdict colours. */
export const CATEGORY_TONE: Record<Category, "live" | "medium" | "high" | "critical"> = { A: "live", B: "medium", C: "high", D: "critical" };
