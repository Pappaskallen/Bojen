/**
 * When the flows F1, F5, F7 and F9 send, and how times read in their sms (byggplan step 3.3,
 * spec part 1, chapter 7). Times are UTC inside and Stockholm time in the texts.
 */
import { sv } from "../i18n/sv";
import type { BookingWindow } from "../scheduling/availability";
import { addDays, isoWeekday, stockholmDate, stockholmInstant } from "../time";

const HOUR = 3_600_000;

/** HH:MM in Stockholm. */
export function stockholmTime(instant: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/** "ons" */
export function weekdayShort(instant: Date): string {
  return sv.flows.weekdaysShort[isoWeekday(stockholmDate(instant)) - 1] ?? "";
}

/** "22/10" */
export function dayMonth(instant: Date): string {
  const [, month, day] = stockholmDate(instant).split("-").map(Number) as [number, number, number];
  return `${String(day)}/${String(month)}`;
}

/** "08" for 08:00, "08:30" otherwise. */
const shortTime = (hhmm: string) => (hhmm.endsWith(":00") ? hhmm.slice(0, 2) : hhmm);

/**
 * The window promised to the customer, "08–12": the firm's booking window that holds the
 * start, or the visit's own times when it lies outside every window.
 */
export function promisedWindow(start: Date, end: Date, windows: readonly BookingWindow[]): string {
  const time = stockholmTime(start);
  const window = windows.find((w) => w.start <= time && time < w.end);
  const from = window?.start ?? time;
  const to = window?.end ?? stockholmTime(end);
  return `${shortTime(from)}–${shortTime(to)}`;
}

/** F5 goes out at 07:00 on the day of the visit. */
export function etaSendTime(visitStart: Date): Date {
  return stockholmInstant(stockholmDate(visitStart), "07:00");
}

/**
 * F5's "ca kl 09:00–11:00": the planned start, to the nearest quarter, give or take an hour.
 * The route planning of the day view (step 5.5) gives a better start later.
 */
export function etaWindow(plannedStart: Date): { from: string; to: string } {
  const quarter = 15 * 60_000;
  const rounded = Math.round(plannedStart.getTime() / quarter) * quarter;
  return {
    from: stockholmTime(new Date(rounded - HOUR)),
    to: stockholmTime(new Date(rounded + HOUR)),
  };
}

/** F9: 18 hours after the job is done, moved into 10:00–19:00 in Stockholm. */
export function surveySendTime(doneAt: Date): Date {
  const wanted = new Date(doneAt.getTime() + 18 * HOUR);
  const day = stockholmDate(wanted);
  const time = stockholmTime(wanted);
  if (time < "10:00") return stockholmInstant(day, "10:00");
  if (time >= "19:00") return stockholmInstant(addDays(day, 1), "10:00");
  return wanted;
}

/** F9 is not sent to a customer who got the question less than 90 days ago. */
export const SURVEY_QUIET_DAYS = 90;

export function surveyAllowed(lastSurveyAt: Date | null, now: Date): boolean {
  return (
    lastSurveyAt === null || now.getTime() - lastSurveyAt.getTime() >= SURVEY_QUIET_DAYS * 24 * HOUR
  );
}

/** F9's answer: 4–5 asks for a review, 1–3 makes a task for a call within 24 hours. */
export function surveyFollowUp(score: number): "review" | "call_back" {
  return score >= 4 ? "review" : "call_back";
}

/** "tis 21/10 kl 12", the last moment the customer may cancel free of charge. */
export function cancelBy(visitStart: Date, cutoffHours: number): string {
  const at = new Date(visitStart.getTime() - cutoffHours * HOUR);
  return `${weekdayShort(at)} ${dayMonth(at)} kl ${shortTime(stockholmTime(at))}`;
}

/** First name for "Hej {förnamn}!". */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
