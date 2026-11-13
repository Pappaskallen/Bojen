import { describe, expect, it } from "vitest";
import { MAX_EXHAUSTIVE_STOPS, suggestOrder, type RouteStop } from "./order";

/** Places on a line: travel time is the distance in minutes, as seconds. */
const at: Record<string, number> = { A: 0, B: 10, C: 20, D: 30, E: 40, F: 50, G: 60, H: 70, I: 80 };
const travel = (from: string, to: string) => Math.abs((at[from] ?? 0) - (at[to] ?? 0)) * 60;

const base = new Date("2026-11-18T07:00:00Z");
let n = 0;
const stop = (placeId: string | null, window = 0, minutes = n * 30): RouteStop => {
  n += 1;
  return {
    id: `v${String(n)}-${placeId ?? "none"}`,
    placeId,
    window,
    start: new Date(base.getTime() + minutes * 60_000),
  };
};

describe("the order of the day's visits", () => {
  it("finds the shortest drive among all orders", () => {
    n = 0;
    // Booked A, C, B, D: 20 + 10 + 20 = 50 min. Best A, B, C, D: 30 min.
    const stops = [stop("A"), stop("C"), stop("B"), stop("D")];
    const s = suggestOrder(stops, travel);
    expect(s.order).toEqual(["v1-A", "v3-B", "v2-C", "v4-D"]);
    expect(s.bookedSeconds).toBe(50 * 60);
    expect(s.suggestedSeconds).toBe(30 * 60);
    expect(s.exhaustive).toBe(true);
  });

  it("never puts a later window before an earlier one", () => {
    n = 0;
    // The morning is at D, the afternoon at A and B: the drive back cannot be avoided.
    const stops = [stop("D", 0), stop("A", 1), stop("B", 1)];
    const s = suggestOrder(stops, travel);
    expect(s.order[0]).toBe("v1-D");
    // Within the afternoon: B (closer to D) first, then A.
    expect(s.order).toEqual(["v1-D", "v3-B", "v2-A"]);
    expect(s.suggestedSeconds).toBe((20 + 10) * 60);
  });

  it("keeps the booked order when nothing is shorter", () => {
    n = 0;
    const stops = [stop("A"), stop("B"), stop("C")];
    const s = suggestOrder(stops, travel);
    expect(s.order).toEqual(["v1-A", "v2-B", "v3-C"]);
    expect(s.suggestedSeconds).toBe(s.bookedSeconds);
  });

  it("costs nothing to reach a visit at the same place or an unknown one", () => {
    n = 0;
    const stops = [stop("A"), stop(null), stop("A")];
    expect(suggestOrder(stops, travel).bookedSeconds).toBe(0);
  });

  it("tries every order up to 8 stops, and keeps the booked order with more", () => {
    n = 0;
    const eight = ["H", "A", "G", "B", "F", "C", "E", "D"].map((p) => stop(p));
    const s8 = suggestOrder(eight, travel);
    expect(s8.exhaustive).toBe(true);
    expect(s8.suggestedSeconds).toBe(70 * 60);
    // Along the line, one way or the other.
    const places = s8.order.map((id) => id.split("-")[1]).join("");
    expect(["ABCDEFGH", "HGFEDCBA"]).toContain(places);
    expect(MAX_EXHAUSTIVE_STOPS).toBe(8);

    n = 0;
    const nine = ["H", "A", "G", "B", "F", "C", "E", "D", "I"].map((p) => stop(p));
    const s9 = suggestOrder(nine, travel);
    expect(s9.exhaustive).toBe(false);
    expect(s9.order).toEqual(nine.map((s) => s.id));
    expect(s9.suggestedSeconds).toBe(s9.bookedSeconds);
  });

  it("orders by window, then booked start, for the booked order", () => {
    n = 0;
    const late = stop("A", 1, 0);
    const early = stop("B", 0, 60);
    expect(suggestOrder([late, early], travel).order).toEqual([early.id, late.id]);
  });
});
