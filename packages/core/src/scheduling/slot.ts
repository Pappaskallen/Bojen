import { isoWeekday, stockholmDate, stockholmInstant } from "../time";
import { subtractSpans, type BusyInterval, type WorkPeriod } from "./availability";

export interface SlotCheck {
  mechanicId: string;
  start: Date;
  durationMinutes: number;
  bufferMinutes: number;
  schedule: readonly WorkPeriod[];
  blocks: readonly BusyInterval[];
  /** Other visits that hold time, without cancelled ones and without the visit itself. */
  visits: readonly BusyInterval[];
}

export type SlotProblem = "outside_working_hours" | "blocked" | "overlaps_visit";

/**
 * Whether one exact time is free for a mechanic: inside working hours, outside blocked
 * time, and at least the buffer away from other visits. Used when a booking is written,
 * under a lock, so a time shown earlier is checked again against the calendar as it is now.
 */
export function checkSlot(input: SlotCheck): SlotProblem | null {
  const start = input.start.getTime();
  const end = start + input.durationMinutes * 60_000;
  const buffer = input.bufferMinutes * 60_000;
  const day = stockholmDate(input.start);
  const mine = <T extends { mechanicId: string }>(list: readonly T[]) =>
    list.filter((x) => x.mechanicId === input.mechanicId);
  const span = (b: BusyInterval) => ({ start: b.start.getTime(), end: b.end.getTime() });
  const inside = (free: { start: number; end: number }[]) =>
    free.some((f) => f.start <= start && end <= f.end);

  const working = mine(input.schedule)
    .filter(
      (p) =>
        p.weekday === isoWeekday(day) &&
        (!p.validFrom || p.validFrom <= day) &&
        (!p.validTo || day <= p.validTo),
    )
    .map((p) => ({
      start: stockholmInstant(day, p.start).getTime(),
      end: stockholmInstant(day, p.end).getTime(),
    }));
  if (!inside(working)) return "outside_working_hours";
  if (!inside(subtractSpans(working, mine(input.blocks).map(span)))) return "blocked";
  const overlaps = mine(input.visits).some(
    (v) => v.start.getTime() - buffer < end && start < v.end.getTime() + buffer,
  );
  return overlaps ? "overlaps_visit" : null;
}
