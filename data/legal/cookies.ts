/**
 * Cookie and storage notice — DRAFT for legal review.
 *
 * Sources consulted (read 2026-10-09): Directive 2002/58/EC Article 5(3) (original text
 * only; consolidated text not read); Romanian Law 506/2004 Article 4(5)–(6), the
 * exemption for storage strictly necessary for a service the user expressly requested.
 *
 * Every entry below was read from the code on 2026-10-09: src/lib/auth/session.ts and
 * src/lib/workflow/identity.ts (nv_ws, nv_invite), @supabase/ssr's defaults and
 * src/proxy.ts (sb-*), src/components/ui/motion.ts (localStorage). nv_recovery is in the
 * password-reset fix that is not yet merged; it is listed so the notice is current when
 * it ships. No analytics, advertising or monitoring script exists in the code.
 */
import type { LegalDocument } from "./types.ts";

export interface StorageItem {
  name: string;
  kind: "cookie" | "local storage";
  setBy: string;
  purpose: string;
  duration: string;
  category: "strictly necessary" | "preference";
}

export const STORAGE: readonly StorageItem[] = [
  {
    name: "sb-[PROJECT REF]-auth-token (may be split into numbered parts)",
    kind: "cookie",
    setBy: "Novera, through the Supabase authentication library",
    purpose: "Keeps a signed-in person signed in; refreshed on each request",
    duration: "Up to 400 days unless the person signs out (library default)",
    category: "strictly necessary",
  },
  {
    name: "sb-[PROJECT REF]-auth-token-code-verifier",
    kind: "cookie",
    setBy: "Novera, through the Supabase authentication library",
    purpose: "Completes a sign-in, confirmation or reset link in the browser that asked for it",
    duration: "Removed when the link is used; otherwise the library default of up to 400 days",
    category: "strictly necessary",
  },
  {
    name: "nv_ws",
    kind: "cookie",
    setBy: "Novera",
    purpose: "Remembers which of a person's workspaces is active. Checked against live membership on every request",
    duration: "1 year; http-only",
    category: "strictly necessary",
  },
  {
    name: "nv_invite",
    kind: "cookie",
    setBy: "Novera",
    purpose: "Holds an invitation opened before signing in, so it can be offered after sign-in. Grants nothing by itself",
    duration: "7 days; http-only",
    category: "strictly necessary",
  },
  {
    name: "nv_recovery",
    kind: "cookie",
    setBy: "Novera (with the password-reset change now in progress)",
    purpose: "Proves the browser arrived through a password-reset link a moment ago",
    duration: "About 15 minutes, used once; http-only",
    category: "strictly necessary",
  },
  {
    name: "novera.motion",
    kind: "local storage",
    setBy: "Novera",
    purpose: "Remembers whether the person switched off the animation of the sample report on the home page",
    duration: "Until the person clears it",
    category: "preference",
  },
];

const cell = (s: string) => s.replace(/\|/g, "/");

function table(): string {
  return [
    "| Name | Type | Purpose | Duration | Category |",
    "| --- | --- | --- | --- | --- |",
    ...STORAGE.map((c) => `| ${[c.name, c.kind, c.purpose, c.duration, c.category].map(cell).join(" | ")} |`),
  ].join("\n");
}

export const cookies: LegalDocument = {
  slug: "cookies",
  title: "Cookies and storage",
  summary: "The cookies and browser storage Novera actually uses, and the boundary for anything added later.",
  status: "draft",
  version: "0.1 draft",
  lastReviewed: "2026-10-09",
  sources: ["eprivacy", "ro-506-2004", "gdpr"],
  body: `This notice lists everything Novera stores in a visitor's browser. It was written from the code, not from a template.

## What Novera stores

${table()}

The authentication cookies are set by Novera's own pages through its authentication provider's library; they are not third-party cookies. Novera sets no cookie for a visitor who only reads public pages and does not sign in, apart from those listed when a person follows an invitation or a sign-in link.

## What Novera does not use

Novera uses no analytics, advertising, tracking or social-media cookies or scripts, and loads no third-party script on its pages. Fonts are served from Novera's own domain.

## Consent

Novera does not show a cookie banner, because the cookies above are, in Novera's assessment, strictly necessary for a service the person asked for: signing in, staying in the right workspace, accepting an invitation and resetting a password. [COUNSEL TO CONFIRM THAT EACH ENTRY QUALIFIES FOR THE STRICTLY-NECESSARY EXEMPTION, IN PARTICULAR THE 400-DAY SESSION LIFETIME AND THE ANIMATION PREFERENCE IN LOCAL STORAGE.]

## Before anything else is added

Analytics, monitoring or any other non-essential storage will not be added until this notice is updated and, where the law requires it, consent is asked for before anything is stored. A first-party product measurement that stores nothing in the browser is the approach currently planned. [COUNSEL TO CONFIRM WHETHER A CONSENT MECHANISM IS NEEDED FOR THE CHOSEN APPROACH.]

## Contact

Questions about this notice: [PRIVACY CONTACT EMAIL]. The Privacy Notice explains how personal data is handled more broadly.`,
};
