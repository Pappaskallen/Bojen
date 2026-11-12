import { BookingError } from "@bojen/db";
import { describe, expect, it } from "vitest";
import { parseSlot, problemFor, slotValue } from "./customer-page";

const MECHANIC = "6f1c2a4e-1d3b-4c5a-9e8f-0a1b2c3d4e5f";

describe("the customer page", () => {
  it("reads a chosen time back from the form", () => {
    const start = "2026-11-20T07:00:00.000Z";
    expect(parseSlot(slotValue({ mechanicId: MECHANIC, start }))).toEqual({
      mechanicId: MECHANIC,
      start: new Date(start),
    });
  });

  it("refuses a time that is not one", () => {
    for (const bad of [
      undefined,
      "",
      "x|2026-11-20T07:00:00Z",
      `${MECHANIC}|igår`,
      `${MECHANIC}`,
      `${MECHANIC}|${"9".repeat(100)}`,
    ]) {
      expect(parseSlot(bad)).toBeNull();
    }
  });

  it("explains every refusal in the customer's words", () => {
    expect(problemFor(new BookingError("link_used"))).toBe("used");
    expect(problemFor(new BookingError("link_expired"))).toBe("expired");
    expect(problemFor(new BookingError("not_found", "link"))).toBe("missing");
    expect(problemFor(new BookingError("conflict", "overlaps_visit"))).toBe("taken");
    expect(problemFor(new BookingError("too_late"))).toBe("closed");
    expect(problemFor(new BookingError("invalid_transition"))).toBe("closed");
    expect(problemFor(new BookingError("invalid_input", "access"))).toBe("invalid");
    expect(problemFor(new Error("database down"))).toBe("failed");
  });
});
