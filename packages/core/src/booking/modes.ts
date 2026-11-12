import { addDays } from "../time";
import type { ModePeriod, PlacementMode } from "../scheduling/suggest";

/**
 * The boat's mode over time from what the customer answers on the booking page: where it is
 * now and, optionally, the day that changes (haul-out or launch). From that day the boat is
 * on land if it was in the water, and in the water if it was on land or indoors.
 */
export function modeTimeline(current: PlacementMode, changeDate?: string | null): ModePeriod[] {
  if (!changeDate) return [{ mode: current }];
  const after: PlacementMode = current === "water" ? "land" : "water";
  return [
    { mode: current, to: addDays(changeDate, -1) },
    { mode: after, from: changeDate },
  ];
}
