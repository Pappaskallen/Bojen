import { describe, expect, it } from "vitest";
import { createFakeClock } from "./clock";

describe("createFakeClock", () => {
  it("starts at the given time and advances on demand", () => {
    const clock = createFakeClock(new Date("2027-03-01T07:00:00Z"));
    clock.advance(60 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2027-03-01T08:00:00.000Z");
  });
});
