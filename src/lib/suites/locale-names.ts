/**
 * The languages a run can be sent in, and their names. Browser-safe — no suite files, no
 * hashing — so the run launcher and the public seal check can name a language without pulling
 * the variant registry (`locales.ts`) into a client bundle.
 */
export const LOCALES = ["en", "de", "fr", "ro"] as const;
export type Locale = (typeof LOCALES)[number];
/** The languages a sidecar may hold; English is the suite itself. */
export const VARIANT_LOCALES = ["de", "fr", "ro"] as const;
export type VariantLocale = (typeof VARIANT_LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "German", fr: "French", ro: "Romanian" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function isVariantLocale(value: unknown): value is VariantLocale {
  return typeof value === "string" && (VARIANT_LOCALES as readonly string[]).includes(value);
}
