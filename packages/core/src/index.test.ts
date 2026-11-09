import { describe, expect, it } from "vitest";
import { DISPLAY_TIME_ZONE, sv } from "./index";

describe("@bojen/core", () => {
  it("exposes Swedish texts", () => {
    expect(sv.app.name).toBe("Bojen");
  });

  it("displays times in a valid IANA zone", () => {
    expect(() => new Intl.DateTimeFormat("sv-SE", { timeZone: DISPLAY_TIME_ZONE })).not.toThrow();
  });
});
