import { describe, expect, it } from "vitest";
import {
  change,
  formatChange,
  formatKpi,
  formatMinutes,
  isoWeek,
  kpiFromSlug,
  lastWeeks,
  monthPeriod,
  shiftMonth,
  sparkline,
  weeksIn,
  yearBefore,
} from "./dashboard";

describe("the dashboard's month", () => {
  it("runs from the first to the last day", () => {
    expect(monthPeriod("2027-05")).toEqual({ from: "2027-05-01", to: "2027-05-31" });
    expect(monthPeriod("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthPeriod("2027-12")).toEqual({ from: "2027-12-01", to: "2027-12-31" });
    expect(monthPeriod("2027-13")).toBeNull();
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2027-12", 1)).toBe("2028-01");
  });

  it("is compared with the same days last year", () => {
    expect(yearBefore({ from: "2028-02-01", to: "2028-02-29" })).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
    expect(change(112, 100)).toBeCloseTo(0.12);
    expect(change(100, 0)).toBeNull();
    expect(change(null, 3)).toBeNull();
  });

  it("is split into ISO weeks, cut to the month", () => {
    expect(isoWeek("2027-05-03")).toBe(18);
    expect(isoWeek("2027-01-01")).toBe(53);
    expect(isoWeek("2026-12-31")).toBe(53);
    const weeks = weeksIn({ from: "2027-05-01", to: "2027-05-31" });
    expect(weeks.map((w) => w.week)).toEqual([17, 18, 19, 20, 21, 22]);
    expect(weeks[0]).toEqual({ week: 17, from: "2027-05-01", to: "2027-05-02" });
    expect(weeks.at(-1)).toEqual({ week: 22, from: "2027-05-31", to: "2027-05-31" });
    expect(lastWeeks("2027-05-05", 2)).toEqual([
      { week: 17, from: "2027-04-26", to: "2027-05-02" },
      { week: 18, from: "2027-05-03", to: "2027-05-09" },
    ]);
  });
});

describe("the figures as text", () => {
  it("follow the sketch", () => {
    expect(formatKpi("revenue", 14_230_000)).toBe("142 300 kr");
    expect(formatKpi("occupancy", 0.91)).toBe("91 %");
    expect(formatKpi("visitsPerMarinaStop", 2.7)).toBe("2,7");
    expect(formatKpi("noAccess", 0.012)).toBe("1,2 %");
    expect(formatKpi("hoursToBooking", 3.5)).toBe("3,5 h");
    expect(formatKpi("csat", null)).toBe("–");
    expect(formatChange(0.12)).toBe("▲ 12 %");
    expect(formatChange(-0.03)).toBe("▼ 3 %");
    expect(formatMinutes(70)).toBe("1 h 10 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
  });

  it("draw the weeks as bars", () => {
    expect(sparkline([1, 3, 5, 6, 8, 7])).toBe("▂▄▅▆█▇");
    expect(sparkline([null, 0])).toBe("▁▁");
  });

  it("find a card by its address", () => {
    expect(kpiFromSlug("belaggning")).toBe("occupancy");
    expect(kpiFromSlug("okand")).toBeNull();
  });
});

describe("the month's name", () => {
  it("is Swedish", async () => {
    const { monthLabel } = await import("./dashboard");
    expect(monthLabel("2027-05")).toBe("maj 2027");
    expect(monthLabel("2026-12", false)).toBe("december");
  });
});
