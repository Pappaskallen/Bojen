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

/** Minutes the Stockholm clock is ahead of UTC at an instant: 60 in winter, 120 in summer. */
export function stockholmOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * The instant at which the Stockholm clock shows `hhmm` on `day` (`YYYY-MM-DD`).
 * Times that do not exist (02:00–03:00 when summer time starts) move forward an hour.
 */
export function stockholmInstant(day: string, hhmm: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const [hour, minute] = hhmm.split(":").map(Number) as [number, number];
  const wallClock = Date.UTC(year, month - 1, date, hour, minute);
  // Guess with the offset at the wall-clock time, then correct once for a DST change.
  let instant = wallClock - stockholmOffsetMinutes(new Date(wallClock)) * 60_000;
  instant = wallClock - stockholmOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant);
}

/** ISO weekday of a calendar day: 1 is Monday, 7 is Sunday. */
export function isoWeekday(day: string): number {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The calendar days from `first` to `last`, both included. */
export function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${first}T12:00:00Z`); d <= new Date(`${last}T12:00:00Z`);) {
    days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 3600 * 1000);
  }
  return days;
}
