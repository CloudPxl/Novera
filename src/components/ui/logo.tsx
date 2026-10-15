/**
 * The Novera logomark: two tall bars offset against each other and a short block suspended
 * between them — an abstract N, the middle block the verdict two graders converge on.
 *
 * Drawn, never an image: the bars fill with `currentColor`, so the mark takes the text colour
 * of wherever it sits — ink on the light theme, light on the operator dark theme, paper on a
 * dark card — and stays crisp at any size. Geometry is shared with the favicon, the Apple
 * icon and the Open Graph card (`LOGO_BARS`), so every rendering is the same mark.
 */

import { LOGO_BARS } from "./logo-bars.ts";

// The geometry lives in a plain module so non-React code (the badge SVG, tests) can read it.
export { LOGO_BARS };

/**
 * The mark alone. Decorative by default: the link or text beside it names Novera. When a link
 * holds the mark and nothing else, pass `label`. Inside an element with the `group` class, the
 * outer bars draw level with the core on hover or focus — motion only where it is wanted.
 */
export function LogoMark({ className = "size-6", label }: { className?: string; label?: string }) {
  const [left, core, right] = LOGO_BARS;
  const bar = "transition-transform duration-200 ease-out motion-reduce:transition-none";
  return (
    <svg
      viewBox="0 0 100 100"
      className={`shrink-0 ${className}`}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <rect {...left} className={`${bar} group-hover:translate-y-[4px] group-focus-visible:translate-y-[4px]`} />
      <rect {...core} />
      <rect {...right} className={`${bar} group-hover:-translate-y-[4px] group-focus-visible:-translate-y-[4px]`} />
    </svg>
  );
}

/** The mark as an SVG string, for places that need a file rather than a component. */
export function logoSvg({ fill, background, size = 100 }: { fill: string; background?: string; size?: number }): string {
  const rects = LOGO_BARS.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${fill}"/>`).join("");
  const bg = background ? `<rect width="100" height="100" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${bg}${rects}</svg>`;
}
