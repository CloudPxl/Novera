/**
 * Country of establishment, validated with the runtime's own region data (Intl.DisplayNames),
 * never a list kept in this repository. A two-letter code is accepted when the runtime knows it
 * as a region; the form shows the name it resolves to, so a mistyped code is visible.
 */
const regions = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

export function countryName(code: string): string | null {
  if (!/^[A-Z]{2}$/.test(code)) return null;
  try {
    const name = regions.of(code);
    // The runtime names placeholder codes "Unknown Region"; that is not a country.
    return name && name !== code && name !== "Unknown Region" ? name : null;
  } catch {
    return null;
  }
}
