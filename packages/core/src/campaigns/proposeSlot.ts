/**
 * The time a campaign holds for a boat (F11, byggplan step 5.6): the same ISO week and, if it
 * can, the same weekday as last year, preferring a day the firm is already at the boat's
 * marina, so the marina's boats are done together. Pure.
 */
import { addDays, isoWeekday, stockholmDate, stockholmInstant } from "../time";

/** ISO 8601 week of a calendar day: the week with the year's first Thursday is week 1. */
export function isoWeekOf(day: string): { year: number; week: number } {
  const thursday = addDays(day, 4 - isoWeekday(day));
  const year = Number(thursday.slice(0, 4));
  const firstThursday = addDays(`${String(year)}-01-04`, 4 - isoWeekday(`${String(year)}-01-04`));
  const days = Math.round(
    (Date.parse(`${thursday}T12:00:00Z`) - Date.parse(`${firstThursday}T12:00:00Z`)) / 86_400_000,
  );
  return { year, week: days / 7 + 1 };
}

/** The day of ISO `week` in `year` that is `weekday` (1 Monday … 7 Sunday). */
export function dayOfIsoWeek(year: number, week: number, weekday: number): string {
  const jan4 = `${String(year)}-01-04`;
  const monday1 = addDays(jan4, 1 - isoWeekday(jan4));
  return addDays(monday1, (week - 1) * 7 + (weekday - 1));
}

export interface TargetWeek {
  /** Monday of the week to hold a time in. */
  monday: string;
  /** The weekday to prefer: last year's, else none. */
  weekday: number | null;
  /** Last year's week number, for the sms ("v.17"). Null when there was no visit. */
  lastWeek: number | null;
}

/**
 * The week this spring that matches last year's visit. Without one (segment B) it is the
 * week before the boat goes in the water at its marina, or else the campaign's own week.
 */
export function targetWeek(input: {
  year: number;
  lastSpring: Date | null;
  /** The boat's launch date this year, from its winter place. */
  launchDate: string | null;
  /** The campaign's week when nothing else says, for example 16. */
  defaultWeek: number;
}): TargetWeek {
  if (input.lastSpring) {
    const day = stockholmDate(input.lastSpring);
    const { week } = isoWeekOf(day);
    return {
      monday: dayOfIsoWeek(input.year, week, 1),
      weekday: isoWeekday(day),
      lastWeek: week,
    };
  }
  if (input.launchDate && input.launchDate.startsWith(String(input.year))) {
    const { week } = isoWeekOf(addDays(input.launchDate, -7));
    return { monday: dayOfIsoWeek(input.year, week, 1), weekday: null, lastWeek: null };
  }
  return { monday: dayOfIsoWeek(input.year, input.defaultWeek, 1), weekday: null, lastWeek: null };
}

export interface SlotOption {
  day: string;
  marinaDay: boolean;
  start: Date;
}

/**
 * The best of the free times in the target week (Monday to Friday): a marina day first, then
 * last year's weekday, then the earliest. Null when the week has no free time.
 */
export function chooseSlot<S extends SlotOption>(
  options: readonly S[],
  target: TargetWeek,
): S | null {
  const friday = addDays(target.monday, 4);
  const inWeek = options.filter((o) => o.day >= target.monday && o.day <= friday);
  const rank = (o: S) =>
    (o.marinaDay ? 0 : 2) +
    (target.weekday !== null && isoWeekday(o.day) === target.weekday ? 0 : 1);
  return (
    [...inWeek].sort((a, b) => rank(a) - rank(b) || a.start.getTime() - b.start.getTime())[0] ??
    null
  );
}

/** Sends go out Tuesday to Thursday at 18:30 (spec F11). */
export const SEND_WEEKDAYS = [2, 3, 4];
export const SEND_TIME = "18:30";
export const DEFAULT_BATCH_SIZE = 40;
export const DEFAULT_TARGET_WEEK = 16;
/** A held time is released if nobody answers within this many days. */
export const HOLD_DAYS = 14;

/** The first send moment (Tuesday–Thursday 18:30, Stockholm) at or after `from`. */
export function nextSendAt(from: Date): Date {
  let day = stockholmDate(from);
  for (let i = 0; i < 8; i++, day = addDays(day, 1)) {
    if (!SEND_WEEKDAYS.includes(isoWeekday(day))) continue;
    const at = stockholmInstant(day, SEND_TIME);
    if (at.getTime() >= from.getTime()) return at;
  }
  throw new Error("No send day within a week");
}

/**
 * The next round's recipients: grouped by marina, so the times held for one marina are
 * chosen together and can share a day, then by last year's date.
 */
export function nextRound<R extends { locationId: string | null; when: string }>(
  pending: readonly R[],
  size: number,
): R[] {
  // Boats without a known place come last: they cannot share a marina day.
  const place = (r: R) => (r.locationId === null ? 1 : 0);
  return [...pending]
    .sort(
      (a, b) =>
        place(a) - place(b) ||
        (a.locationId ?? "").localeCompare(b.locationId ?? "") ||
        a.when.localeCompare(b.when),
    )
    .slice(0, size);
}
