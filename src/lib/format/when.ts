/**
 * A moment, in the person's own timezone and date style (their profile). Display only:
 * stored times, reports and exports stay in UTC, so a sealed document reads the same to
 * everyone.
 */
export function formatWhen(iso: string, profile: { timezone: string; locale: string }, opts: { date?: boolean } = {}): string {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat(profile.locale || "en-GB", {
      timeZone: profile.timezone || "UTC",
      day: "numeric", month: "short", year: "numeric",
      ...(opts.date ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }),
    });
    return fmt.format(d);
  } catch {
    return iso.slice(0, 16).replace("T", " ") + " UTC";
  }
}

/** The short name of a timezone for a label: "Europe/Bucharest" → "Bucharest", UTC as is. */
export function zoneLabel(timezone: string): string {
  return timezone === "UTC" ? "UTC" : (timezone.split("/").at(-1) ?? timezone).replace(/_/g, " ");
}
