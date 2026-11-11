import { daysBetween, isoWeekday, stockholmInstant } from "../time";

/**
 * Free booking windows per mechanic and day (byggplan step 2.1, spec A3 and W3).
 *
 * Jobs are booked into the firm's windows, for example 08–12, 12–16 and 16–19. The
 * customer is promised the window; the visit itself is the planned working time. A window
 * is offered when a job of the service's length can start inside it and fits in a gap
 * between working hours, blocked time and other visits. Other visits are padded with the
 * firm's buffer on both sides (packing up, moving the van, walking the pontoons).
 *
 * Local times (schedule and windows) are wall-clock times in Stockholm; everything else is
 * an instant. Pure: no I/O, the caller passes `now`.
 */

/** `HH:MM`, wall-clock time in Stockholm. */
export type LocalTime = `${number}:${number}`;

export interface WorkPeriod {
  mechanicId: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
  start: LocalTime;
  end: LocalTime;
  /** First and last day the period applies (`YYYY-MM-DD`), both included. */
  validFrom?: string | null;
  validTo?: string | null;
}

export interface BusyInterval {
  mechanicId: string;
  start: Date;
  end: Date;
}

export interface BookingWindow {
  start: LocalTime;
  end: LocalTime;
}

export interface AvailabilityInput {
  /** First and last day to look at (`YYYY-MM-DD`), both included. */
  from: string;
  to: string;
  durationMinutes: number;
  bufferMinutes: number;
  windows: readonly BookingWindow[];
  schedule: readonly WorkPeriod[];
  /** Holidays, sick days, training and other blocked time. */
  blocks: readonly BusyInterval[];
  /** Visits that hold time. The caller leaves out cancelled visits. */
  visits: readonly BusyInterval[];
  /** Nothing is offered before this instant. */
  now: Date;
  /** Starts are rounded up to this step. Default 15 minutes. */
  stepMinutes?: number;
}

export interface OfferedWindow {
  mechanicId: string;
  day: string;
  /** The window as the customer sees it, for example `08–12`. */
  label: string;
  windowStart: Date;
  windowEnd: Date;
  /** The earliest time the job can start inside the window. */
  earliestStart: Date;
}

/** Half-open interval `[start, end)` in milliseconds since the epoch. */
interface Span {
  start: number;
  end: number;
}

const MINUTE = 60_000;

/** Removes the busy spans from the free ones. Both lists may be unsorted. */
export function subtractSpans(free: readonly Span[], busy: readonly Span[]): Span[] {
  let result = [...free].sort((a, b) => a.start - b.start);
  for (const b of busy) {
    result = result.flatMap((f) => {
      if (b.end <= f.start || b.start >= f.end) return [f];
      const parts: Span[] = [];
      if (b.start > f.start) parts.push({ start: f.start, end: b.start });
      if (b.end < f.end) parts.push({ start: b.end, end: f.end });
      return parts;
    });
  }
  return result;
}

function appliesOn(period: WorkPeriod, day: string): boolean {
  return (
    period.weekday === isoWeekday(day) &&
    (!period.validFrom || period.validFrom <= day) &&
    (!period.validTo || day <= period.validTo)
  );
}

function roundUp(ms: number, step: number): number {
  return Math.ceil(ms / step) * step;
}

const label = (w: BookingWindow) => `${w.start.slice(0, 2)}–${w.end.slice(0, 2)}`;

export function availableWindows(input: AvailabilityInput): OfferedWindow[] {
  const duration = input.durationMinutes * MINUTE;
  const buffer = input.bufferMinutes * MINUTE;
  const step = (input.stepMinutes ?? 15) * MINUTE;
  const now = input.now.getTime();
  if (duration <= 0) throw new Error("A service must take some time");

  const mechanics = [...new Set(input.schedule.map((p) => p.mechanicId))].sort();
  const offers: OfferedWindow[] = [];

  for (const day of daysBetween(input.from, input.to)) {
    for (const mechanicId of mechanics) {
      const working = input.schedule
        .filter((p) => p.mechanicId === mechanicId && appliesOn(p, day))
        .map((p) => ({
          start: stockholmInstant(day, p.start).getTime(),
          end: stockholmInstant(day, p.end).getTime(),
        }));
      if (working.length === 0) continue;

      const busy = [
        ...input.blocks
          .filter((b) => b.mechanicId === mechanicId)
          .map((b) => ({ start: b.start.getTime(), end: b.end.getTime() })),
        ...input.visits
          .filter((v) => v.mechanicId === mechanicId)
          .map((v) => ({ start: v.start.getTime() - buffer, end: v.end.getTime() + buffer })),
      ];
      const free = subtractSpans(working, busy);

      for (const window of input.windows) {
        const windowStart = stockholmInstant(day, window.start).getTime();
        const windowEnd = stockholmInstant(day, window.end).getTime();

        let earliest: number | undefined;
        for (const gap of free) {
          const start = roundUp(Math.max(gap.start, windowStart, now), step);
          if (start < windowEnd && start + duration <= gap.end) {
            earliest = start;
            break;
          }
        }
        if (earliest !== undefined) {
          offers.push({
            mechanicId,
            day,
            label: label(window),
            windowStart: new Date(windowStart),
            windowEnd: new Date(windowEnd),
            earliestStart: new Date(earliest),
          });
        }
      }
    }
  }
  return offers;
}
