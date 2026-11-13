/**
 * When the availability check (F3, spec part 1, chapter 7) goes out (byggplan step 4.1).
 * Pure: the worker passes the visit, when it was booked and how urgent the job is.
 *
 *  - The start minus 24 hours.
 *  - If that falls in the quiet hours 21:00–08:00, 18:00 the day before the visit instead.
 *  - Visits on a Monday are checked on Friday at 12:00, so there is time to act before the
 *    weekend. If Friday noon had already passed when the visit was booked, the rules above
 *    apply.
 *  - A visit booked less than 24 hours before its start is not checked: it counts as
 *    confirmed. Neither is an emergency job.
 *  - When the time has already passed at booking, the check goes at once.
 */
import { addDays, isoWeekday, stockholmDate, stockholmInstant } from "../time";
import { stockholmTime } from "../flows/timing";

const HOUR = 3_600_000;

export type JobUrgency = "planned" | "soon" | "emergency";

export interface CheckInput {
  start: Date;
  /** When the visit got its current time: booked, approved or last rescheduled. */
  bookedAt: Date;
  urgency: JobUrgency;
}

/** `tomorrow`: "I morgon"; `monday`: "På måndag", for the check that goes on Friday. */
export type CheckDay = "tomorrow" | "monday";

export type CheckPlan =
  { send: true; at: Date; day: CheckDay } | { send: false; reason: "emergency" | "booked_late" };

const quiet = (instant: Date) => {
  const time = stockholmTime(instant);
  return time >= "21:00" || time < "08:00";
};

export function availabilityCheckTime(input: CheckInput): CheckPlan {
  const { start, bookedAt, urgency } = input;
  if (urgency === "emergency") return { send: false, reason: "emergency" };
  if (start.getTime() - bookedAt.getTime() < 24 * HOUR) {
    return { send: false, reason: "booked_late" };
  }

  const day = stockholmDate(start);
  if (isoWeekday(day) === 1) {
    const friday = stockholmInstant(addDays(day, -3), "12:00");
    if (friday.getTime() > bookedAt.getTime()) return { send: true, at: friday, day: "monday" };
  }

  const before = new Date(start.getTime() - 24 * HOUR);
  const at = quiet(before) ? stockholmInstant(addDays(day, -1), "18:00") : before;
  if (at.getTime() > bookedAt.getTime()) return { send: true, at, day: "tomorrow" };
  // Booked after 18:00 the day before a late visit: at once, unless that is in the quiet
  // hours too, when the sms would only leave the next morning, on the visit's own day.
  if (quiet(bookedAt)) return { send: false, reason: "booked_late" };
  return { send: true, at: bookedAt, day: "tomorrow" };
}
