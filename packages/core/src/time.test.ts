import { describe, expect, it } from "vitest";
import { stockholmDate } from "./time";

describe("stockholmDate", () => {
  it.each([
    ["2027-04-19T22:30:00Z", "2027-04-20"], // 00:30 summer time
    ["2027-04-19T21:30:00Z", "2027-04-19"], // 23:30 summer time
    ["2027-01-14T23:30:00Z", "2027-01-15"], // 00:30 winter time
    ["2027-01-15T22:59:00Z", "2027-01-15"], // 23:59 winter time
  ])("%s is %s in Stockholm", (instant, day) => {
    expect(stockholmDate(new Date(instant))).toBe(day);
  });
});
