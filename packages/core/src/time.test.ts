import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isoWeekday, stockholmDate, stockholmInstant } from "./time";

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

describe("stockholmInstant", () => {
  it.each([
    ["2027-01-15", "08:00", "2027-01-15T07:00:00.000Z"], // winter, UTC+1
    ["2027-07-15", "08:00", "2027-07-15T06:00:00.000Z"], // summer, UTC+2
    ["2027-03-28", "08:00", "2027-03-28T06:00:00.000Z"], // the morning summer time starts
    ["2027-03-28", "01:30", "2027-03-28T00:30:00.000Z"], // before the change
    ["2027-10-31", "08:00", "2027-10-31T07:00:00.000Z"], // the morning summer time ends
    ["2027-03-28", "02:30", "2027-03-28T01:30:00.000Z"], // does not exist; 03:30 summer time
  ])("%s %s in Stockholm is %s", (day, hhmm, iso) => {
    expect(stockholmInstant(day, hhmm).toISOString()).toBe(iso);
  });
});

describe("calendar helpers", () => {
  it("numbers weekdays from Monday", () => {
    expect(isoWeekday("2027-04-19")).toBe(1);
    expect(isoWeekday("2027-04-25")).toBe(7);
  });

  it("lists the days of a range across a DST change", () => {
    expect(daysBetween("2027-03-27", "2027-03-29")).toEqual([
      "2027-03-27",
      "2027-03-28",
      "2027-03-29",
    ]);
  });
});

describe("addDays", () => {
  it("moves across months, years and the change to summer time", () => {
    expect(addDays("2027-01-31", 1)).toBe("2027-02-01");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(addDays("2027-03-27", 2)).toBe("2027-03-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
});
