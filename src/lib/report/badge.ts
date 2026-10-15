import { LOGO_BARS } from "../../components/ui/logo-bars.ts";
import { SITE_ORIGIN } from "../seo/site.ts";
import { buildReceipt, normaliseDigest, type SealReceipt, type SealRow } from "./public-verify.ts";

/**
 * The embeddable badge for a sealed report: `/api/badge/<sha256>`, an SVG a customer can put
 * in a README or on a trust page, linking to the public receipt at `/verify/<sha256>`.
 *
 * Keyed by the report's digest, never by agent: the digest is already public through the seal
 * check, cannot be guessed, and names one dated document rather than "whatever the agent's
 * latest run said". Everything the badge says comes from the same allow-listed receipt the
 * seal check shows (`buildReceipt`), so it can say nothing a stranger holding the digest could
 * not already read there: a built-in suite by key and version, a workspace's own suite as
 * "own suite vN" only, the sealed counts, and whether the run was against test data.
 *
 * Every answer is an image. An unknown or malformed digest, a withdrawn report or a failed
 * lookup is a grey badge that says so, served with 200: a broken image in someone's README
 * says nothing, and an image proxy (GitHub's among them) drops a non-200 answer. The state is
 * also in the `X-Novera-Seal` header for anything that reads headers.
 *
 * Pure, apart from the lookup the caller passes in, so the route and the tests run the same code.
 */

export type BadgeState = "verified" | "withdrawn" | "mismatch" | "unknown" | "malformed" | "unavailable";

export interface BadgeContent {
  state: BadgeState;
  /** The left segment, always the same. */
  label: string;
  /** The right segment. */
  message: string;
  /** The text alternative for an `<img>` of this badge (also the SVG's own title). */
  alt: string;
}

export const BADGE_LABEL = "NOVERA TESTED";
export const BADGE_HEIGHT = 28;

/** Ink, a step lighter for the message, and the mark's own light grey (as on the OG card). */
const LEFT_FILL = "#09090b";
const RIGHT_FILL = "#27272a";
const TEXT_FILL = "#e5e7eb";
const FONT_FAMILY = "Verdana,DejaVu Sans,Geneva,sans-serif";
const FONT_SIZE = 11;
const BASELINE = 18;
const PAD = 10;
const LOGO_SIZE = 14;
const LOGO_GAP = 6;
/** Tracking on the upper-case label, in pixels between letters. */
const LABEL_TRACKING = 1;

const MESSAGES: Record<Exclude<BadgeState, "verified">, string> = {
  withdrawn: "report withdrawn",
  mismatch: "seal does not match",
  unknown: "unverified digest",
  malformed: "unverified digest",
  unavailable: "check unavailable",
};

/** What a badge says, from the receipt; null is a malformed digest, "unavailable" a failed read. */
export function badgeContent(receipt: SealReceipt | "unavailable" | null): BadgeContent {
  if (receipt === null) return fixed("malformed");
  if (receipt === "unavailable") return fixed("unavailable");
  if (receipt.state !== "verified") return fixed(receipt.state);

  const { suite, counts, grade, testData } = receipt.details;
  const suiteText = suite.builtIn ? `${suite.key} v${suite.version}` : suite.version !== null ? `own suite v${suite.version}` : "own suite";

  const facts: string[] = [];
  if (testData) facts.push("test data");
  // A word, never a score, where the band withholds one.
  if (grade?.shownAs === "withheld") facts.push("grade withheld");
  else if (grade?.shownAs === "incomplete") facts.push("run incomplete");
  else if (counts.passed !== null && counts.planned !== null) facts.push(`${counts.passed}/${counts.planned} passed`);

  return {
    state: "verified",
    label: BADGE_LABEL,
    message: [suiteText, ...facts, "sealed"].join(" · "),
    alt: `Novera testing evidence: ${suiteText}${facts.length ? ` (${facts.join(", ")})` : ""}`,
  };
}

function fixed(state: Exclude<BadgeState, "verified">): BadgeContent {
  return { state, label: BADGE_LABEL, message: MESSAGES[state], alt: `Novera testing evidence: ${MESSAGES[state]}` };
}

// ---------------------------------------------------------------- text measurement

/**
 * Verdana's advance widths in font units (2048 per em), printable ASCII. The badge sets each
 * text's `textLength` from these, so a viewer that falls back to another face still draws the
 * text inside the measured box. Anything outside the table is measured as a full em, which can
 * only leave space, never clip.
 */
const VERDANA_UNITS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries({
    " ": 720, "!": 805, "\"": 945, "#": 1677, "$": 1302, "%": 2210, "&": 1489, "'": 554, "(": 909, ")": 909,
    "*": 1302, "+": 1677, ",": 744, "-": 866, ".": 744, "/": 1300, ":": 866, ";": 866, "<": 1677, "=": 1677,
    ">": 1677, "?": 1114, "@": 2048, "[": 909, "\\": 1300, "]": 909, "^": 1677, "_": 1302, "`": 1302,
    "{": 1302, "|": 909, "}": 1302, "~": 1677, "·": 744,
    A: 1401, B: 1405, C: 1430, D: 1577, E: 1294, F: 1178, G: 1577, H: 1540, I: 862, J: 931, K: 1415, L: 1141,
    M: 1724, N: 1532, O: 1612, P: 1235, Q: 1612, R: 1424, S: 1400, T: 1258, U: 1499, V: 1401, W: 2025, X: 1403,
    Y: 1260, Z: 1403,
    a: 1229, b: 1270, c: 1067, d: 1270, e: 1215, f: 723, g: 1270, h: 1297, i: 563, j: 694, k: 1185, l: 563,
    m: 1993, n: 1297, o: 1225, p: 1270, q: 1270, r: 874, s: 1067, t: 807, u: 1297, v: 1185, w: 1677, x: 1185,
    y: 1185, z: 1088,
    ...Object.fromEntries("0123456789".split("").map((d) => [d, 1302])),
  }),
);

/** The width of `text` at `size` px in Verdana, in pixels (unrounded). */
export function textWidth(text: string, size = FONT_SIZE): number {
  let units = 0;
  for (const ch of text) units += VERDANA_UNITS[ch] ?? 2048;
  return (units * size) / 2048;
}

// ---------------------------------------------------------------- drawing

/** XML text and attribute escaping: the five characters that can end a value or start markup. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[c]!);
}

/**
 * The logomark snapped to whole pixels in a LOGO_SIZE box: the bars' bounding box is scaled to
 * the box height and every edge rounded, so the mark is drawn without anti-aliased edges.
 */
export function pixelLogo(size = LOGO_SIZE): Array<{ x: number; y: number; width: number; height: number }> {
  const left = Math.min(...LOGO_BARS.map((b) => b.x));
  const top = Math.min(...LOGO_BARS.map((b) => b.y));
  const bottom = Math.max(...LOGO_BARS.map((b) => b.y + b.height));
  const scale = size / (bottom - top);
  return LOGO_BARS.map((b) => ({
    x: Math.round((b.x - left) * scale),
    y: Math.round((b.y - top) * scale),
    width: Math.round(b.width * scale),
    height: Math.round(b.height * scale),
  }));
}

export interface BadgeGeometry {
  width: number;
  leftWidth: number;
  rightWidth: number;
  labelLength: number;
  messageLength: number;
}

export function badgeGeometry(content: Pick<BadgeContent, "label" | "message">): BadgeGeometry {
  const labelLength = Math.ceil(textWidth(content.label) + LABEL_TRACKING * Math.max(0, [...content.label].length - 1));
  const messageLength = Math.ceil(textWidth(content.message));
  const leftWidth = PAD + LOGO_SIZE + LOGO_GAP + labelLength + PAD;
  const rightWidth = PAD + messageLength + PAD;
  return { width: leftWidth + rightWidth, leftWidth, rightWidth, labelLength, messageLength };
}

/** The badge as a standalone SVG document. No style element, no external font or image. */
export function badgeSvg(content: BadgeContent): string {
  const g = badgeGeometry(content);
  // Read aloud in sentence case: an upper-case label is spelled out by some screen readers.
  const title = escapeXml(`Novera tested: ${content.message}`);
  const logoX = PAD;
  const logoY = (BADGE_HEIGHT - LOGO_SIZE) / 2;
  const bars = pixelLogo()
    .map((b) => `<rect x="${logoX + b.x}" y="${logoY + b.y}" width="${b.width}" height="${b.height}"/>`)
    .join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}" height="${BADGE_HEIGHT}" viewBox="0 0 ${g.width} ${BADGE_HEIGHT}" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<g shape-rendering="crispEdges">`,
    `<rect width="${g.leftWidth}" height="${BADGE_HEIGHT}" fill="${LEFT_FILL}"/>`,
    `<rect x="${g.leftWidth}" width="${g.rightWidth}" height="${BADGE_HEIGHT}" fill="${RIGHT_FILL}"/>`,
    `<g fill="${TEXT_FILL}">${bars}</g>`,
    `</g>`,
    `<g fill="${TEXT_FILL}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" text-rendering="geometricPrecision">`,
    `<text x="${PAD + LOGO_SIZE + LOGO_GAP}" y="${BASELINE}" textLength="${g.labelLength}">${escapeXml(content.label)}</text>`,
    `<text x="${g.leftWidth + PAD}" y="${BASELINE}" textLength="${g.messageLength}">${escapeXml(content.message)}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

// ---------------------------------------------------------------- the response

/**
 * Edge-cached for five minutes, served stale for ten more while it refreshes: a badge on a busy
 * page costs one database read per five minutes, and a withdrawal reaches every copy within
 * fifteen. A failed lookup is not cached at all, so it is not repeated for five minutes.
 */
// Short on purpose: a withdrawn report must stop showing "sealed" within about two minutes
// (a withdrawal takes effect at once everywhere else: the link, exports, /verify).
export const BADGE_CACHE = "public, s-maxage=60, stale-while-revalidate=60";

export function badgeHeaders(state: BadgeState): Record<string, string> {
  return {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": state === "unavailable" ? "no-store" : BADGE_CACHE,
    "X-Content-Type-Options": "nosniff",
    // Opened directly, the SVG may load nothing and run nothing. Served from /api, next.config's
    // stricter "default-src 'none'; frame-ancestors 'none'" replaces this; the SVG has no style
    // element and needs neither.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "X-Novera-Seal": state,
  };
}

/** `<digest>` or `<digest>.svg`, in any case, as the route receives it; null when not a digest. */
export function badgeDigest(param: string): string | null {
  let value = param;
  try {
    value = decodeURIComponent(param);
  } catch {
    return null;
  }
  return normaliseDigest(value.replace(/\.svg$/i, ""));
}

/**
 * The one read the badge makes: the seal check's own lookup (`lookupSeal`), so the badge and
 * the receipt it links to are built from the same row. A failed read is "unavailable", never
 * "unknown".
 */
export type SealLookup = (digest: string) => Promise<SealReceipt | "unavailable">;

export async function badgeResponse(param: string, lookup: SealLookup): Promise<Response> {
  const digest = badgeDigest(param);
  let receipt: SealReceipt | "unavailable" | null = null;
  if (digest) {
    try {
      receipt = await lookup(digest);
    } catch {
      receipt = "unavailable";
    }
  }
  const content = badgeContent(receipt);
  return new Response(badgeSvg(content), { status: 200, headers: badgeHeaders(content.state) });
}

// ---------------------------------------------------------------- what the share dialog copies

export interface BadgeSnippets {
  /** Relative, for the preview on our own page. */
  previewSrc: string;
  badgeUrl: string;
  receiptUrl: string;
  html: string;
  markdown: string;
}

export function badgeSnippets(digest: string, content: BadgeContent, origin = SITE_ORIGIN): BadgeSnippets {
  const badgeUrl = `${origin}/api/badge/${digest}`;
  const receiptUrl = `${origin}/verify/${digest}`;
  return {
    previewSrc: `/api/badge/${digest}`,
    badgeUrl,
    receiptUrl,
    html: `<a href="${receiptUrl}"><img src="${badgeUrl}" alt="${escapeXml(content.alt)}" height="${BADGE_HEIGHT}"></a>`,
    markdown: `[![Novera testing evidence](${badgeUrl})](${receiptUrl})`,
  };
}

export interface BadgeShareProps {
  previewSrc: string;
  previewWidth: number;
  alt: string;
  html: string;
  markdown: string;
}

/**
 * What the "Embed badge" dialog shows for a stored report, or null when there is nothing to
 * offer: a withdrawn report, or one whose stored content no longer hashes to its digest.
 */
export function badgeShareFor(row: SealRow, origin = SITE_ORIGIN): BadgeShareProps | null {
  if (row.revoked_at) return null;
  const digest = normaliseDigest(row.content_hash);
  if (!digest) return null;
  const content = badgeContent(buildReceipt(digest, row));
  if (content.state !== "verified") return null;
  const { previewSrc, html, markdown } = badgeSnippets(digest, content, origin);
  return { previewSrc, previewWidth: badgeGeometry(content).width, alt: content.alt, html, markdown };
}
