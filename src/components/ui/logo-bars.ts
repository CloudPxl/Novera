/**
 * The logomark's geometry, shared by every rendering of it (`LogoMark`, the favicon, the Apple
 * icon, the Open Graph card, the report badge). A plain module, so code without JSX can read it.
 */

/** In a 100 × 100 box, centred both ways. Measured from the approved artwork. */
export const LOGO_BARS = [
  { x: 25.75, y: 26, width: 14.5, height: 40 },
  { x: 46.75, y: 42.75, width: 6.5, height: 14.5 },
  { x: 59.75, y: 34, width: 14.5, height: 40 },
] as const;
