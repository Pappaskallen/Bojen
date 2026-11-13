/**
 * The order to drive the day's visits in (byggplan step 5.5): the shortest total drive, trying
 * every order when there are at most 8 stops (8! = 40 320). The customer has been promised a
 * window, so an order never puts a visit from a later window before one from an earlier.
 * With more stops the booked order stands. Pure: the caller passes the travel times.
 */

export interface RouteStop {
  id: string;
  /** Where the visit is; null when the place is unknown, which then costs nothing to reach. */
  placeId: string | null;
  /** Index of the promised window in the firm's day, 0 for the first. */
  window: number;
  /** The booked start, the order to keep when nothing better is found. */
  start: Date;
}

export const MAX_EXHAUSTIVE_STOPS = 8;

/** Seconds from one place to another, or undefined when the time is not known. */
export type TravelLookup = (fromId: string, toId: string) => number | undefined;

export interface RouteSuggestion {
  /** Stop ids in the suggested order. */
  order: string[];
  /** Total drive in seconds between the stops, booked order and suggested order. */
  bookedSeconds: number;
  suggestedSeconds: number;
  /** Every order was tried (at most 8 stops). */
  exhaustive: boolean;
}

function driveSeconds(stops: readonly RouteStop[], travel: TravelLookup): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1]?.placeId;
    const to = stops[i]?.placeId;
    if (!from || !to || from === to) continue;
    total += travel(from, to) ?? 0;
  }
  return total;
}

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i] as T, ...tail];
  }
}

const windowsInOrder = (stops: readonly RouteStop[]) =>
  stops.every((s, i) => i === 0 || (stops[i - 1]?.window ?? 0) <= s.window);

export function suggestOrder(stops: readonly RouteStop[], travel: TravelLookup): RouteSuggestion {
  const booked = [...stops].sort(
    (a, b) =>
      a.window - b.window || a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id),
  );
  const bookedSeconds = driveSeconds(booked, travel);
  if (booked.length > MAX_EXHAUSTIVE_STOPS) {
    return {
      order: booked.map((s) => s.id),
      bookedSeconds,
      suggestedSeconds: bookedSeconds,
      exhaustive: false,
    };
  }
  let best = booked;
  let bestSeconds = bookedSeconds;
  for (const order of permutations(booked)) {
    if (!windowsInOrder(order)) continue;
    const seconds = driveSeconds(order, travel);
    // Strictly better only, so a tie keeps the booked order.
    if (seconds < bestSeconds) {
      best = order;
      bestSeconds = seconds;
    }
  }
  return {
    order: best.map((s) => s.id),
    bookedSeconds,
    suggestedSeconds: bestSeconds,
    exhaustive: true,
  };
}
