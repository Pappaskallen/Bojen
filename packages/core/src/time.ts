/** Times are stored as UTC and displayed in this zone (see CLAUDE.md). */
export const DISPLAY_TIME_ZONE = "Europe/Stockholm";

/** The calendar day (`YYYY-MM-DD`) of an instant in Stockholm. */
export function stockholmDate(instant: Date): string {
  // The sv-SE locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
