/**
 * Finding the chat input on a page: pure scoring over what the page reported about each
 * candidate. The browser part (page.ts) only gathers these descriptors; the decision is here,
 * where it is tested.
 */
export interface InputDescriptor {
  index: number;
  frameIndex: number;
  inShadow: boolean;
  tag: "textarea" | "input" | "contenteditable";
  type: string | null;
  placeholder: string;
  label: string;
  name: string;
  id: string;
  visible: boolean;
  disabled: boolean;
  readOnly: boolean;
  width: number;
  height: number;
  top: number;
  viewportHeight: number;
}

export interface ButtonDescriptor {
  index: number;
  frameIndex: number;
  text: string;
  label: string;
  visible: boolean;
}

const TEXT_TYPES = new Set(["", "text"]);
const CHATTY = /chat|message|ask|question|type here|type your|write|how can|help you|reply|send/;
const NOT_CHAT = /search|e-?mail|newsletter|subscribe|coupon|promo|voucher|zip|postal|postcode|phone|password|card|username|login|log in|first name|last name|full name|address/;

/** Below this a candidate is not taken: better "no widget found" than typing into the wrong box. */
export const INPUT_THRESHOLD = 20;

export function scoreInput(d: InputDescriptor): number {
  if (!d.visible || d.disabled || d.readOnly) return -Infinity;
  if (d.tag === "input" && !TEXT_TYPES.has((d.type ?? "").toLowerCase())) return -Infinity;
  if (d.width < 40 || d.height < 14) return -Infinity;
  const text = `${d.placeholder} ${d.label} ${d.name} ${d.id}`.toLowerCase();
  let score = 0;
  if (CHATTY.test(text)) score += 40;
  if (NOT_CHAT.test(text)) score -= 60;
  if (d.tag === "textarea") score += 15;
  if (d.tag === "contenteditable") score += 10;
  if (d.inShadow || d.frameIndex > 0) score += 10;
  if (d.viewportHeight > 0 && d.top > d.viewportHeight * 0.5) score += 10;
  if (d.width >= 150 && d.width <= 800) score += 5;
  return score;
}

export function pickInput(candidates: readonly InputDescriptor[]): { descriptor: InputDescriptor; score: number } | null {
  let best: { descriptor: InputDescriptor; score: number } | null = null;
  for (const d of candidates) {
    const score = scoreInput(d);
    if (score >= INPUT_THRESHOLD && (!best || score > best.score)) best = { descriptor: d, score };
  }
  return best;
}

const LAUNCHER = /\bchat\b|assistant|help|support|ask us|ask a question|message us|talk to us|contact us|live chat|need help/i;
const NOT_LAUNCHER = /close|minimi[sz]e|dismiss|hide|sign in|log in|cart|checkout|menu|search/i;

export function pickLauncher(buttons: readonly ButtonDescriptor[]): ButtonDescriptor | null {
  for (const b of buttons) {
    const text = `${b.text} ${b.label}`.trim();
    if (b.visible && text.length <= 60 && LAUNCHER.test(text) && !NOT_LAUNCHER.test(text)) return b;
  }
  return null;
}

/** Cookie banners: one plain acceptance button, top frame only, clicked at most once. */
const CONSENT = /^(accept|accept all|accept all cookies|accept cookies|allow all|allow all cookies|agree|i agree|ok|okay|got it|alle akzeptieren|tout accepter|accepter|aceptar todo|accetta tutto|acceptă tot|accepta tot)$/i;

export function pickConsent(buttons: readonly ButtonDescriptor[]): ButtonDescriptor | null {
  return buttons.find((b) => b.visible && b.frameIndex === 0 && CONSENT.test(`${b.text || b.label}`.trim().replace(/[.!]$/, ""))) ?? null;
}

const SEND = /^(send|send message|submit|ask|go|enter)$/i;

export function pickSend(buttons: readonly ButtonDescriptor[]): ButtonDescriptor | null {
  return buttons.find((b) => b.visible && SEND.test(`${b.label || b.text}`.trim())) ?? null;
}
