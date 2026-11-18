import { describe, expect, it } from "vitest";
import {
  computeKpis,
  DEFAULT_SEASONS,
  kpiLevel,
  kpiSeasons,
  median,
  nextSeason,
  prebookingSnapshotKey,
  type KpiTotals,
} from "./kpi";

const totals: KpiTotals = {
  revenueOre: 3_000_000,
  workDays: 2,
  invoicedJobs: 3,
  bookedMinutes: 900,
  capacityMinutes: 1000,
  labourMinutes: 600,
  driveMinutes: 30,
  onSiteMinutes: 270,
  placeVisits: 5,
  marinaStops: 2,
  noAccessVisits: 1,
  doneOrNoAccessVisits: 20,
  checksSent: 4,
  checksConfirmed: 3,
  freedSlots: 2,
  refilledSlots: 1,
  hoursToFirstVisit: [1, 9, 2],
  surveysAnswered: 4,
  surveysHappy: 3,
};

describe("the KPIs", () => {
  it("are worked out from the sums of the period", () => {
    const k = computeKpis(totals, {
      season: { name: "autumn", from: "2027-09-01", to: "2027-10-31" },
      bookedMinutes: 480,
      capacityMinutes: 1600,
    });
    expect(k).toEqual({
      revenue: 3_000_000,
      revenuePerWorkDay: 1_500_000,
      averageOrder: 1_000_000,
      occupancy: 0.9,
      billableShare: 0.6,
      driveShare: 0.1,
      visitsPerMarinaStop: 2.5,
      noAccess: 0.05,
      confirmation: 0.75,
      refill: 0.5,
      hoursToBooking: 2,
      prebooking: 0.3,
      csat: 0.75,
    });
  });

  it("are empty where nothing is measured, rather than zero", () => {
    const none = computeKpis(
      {
        ...totals,
        workDays: 0,
        invoicedJobs: 0,
        capacityMinutes: 0,
        driveMinutes: 0,
        onSiteMinutes: 0,
        hoursToFirstVisit: [],
        checksSent: 0,
      },
      null,
    );
    expect(none.revenuePerWorkDay).toBeNull();
    expect(none.occupancy).toBeNull();
    expect(none.driveShare).toBeNull();
    expect(none.hoursToBooking).toBeNull();
    expect(none.confirmation).toBeNull();
    expect(none.prebooking).toBeNull();
    expect(none.revenue).toBe(3_000_000);
  });

  it("take the median of an even count as the mean of the middle two", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("colours against the target (spec 9.2)", () => {
  it("are green when met, yellow within 10 % and red beyond", () => {
    expect(kpiLevel("csat", 0.9)).toBe("green");
    expect(kpiLevel("csat", 0.82)).toBe("yellow");
    expect(kpiLevel("csat", 0.8)).toBe("red");
    expect(kpiLevel("driveShare", 0.15)).toBe("green");
    expect(kpiLevel("driveShare", 0.16)).toBe("yellow");
    expect(kpiLevel("driveShare", 0.2)).toBe("red");
  });

  it("know both ends of a range", () => {
    expect(kpiLevel("occupancy", 0.9)).toBe("green");
    expect(kpiLevel("occupancy", 0.8)).toBe("yellow");
    expect(kpiLevel("occupancy", 1.0)).toBe("yellow");
    expect(kpiLevel("occupancy", 0.5)).toBe("red");
  });

  it("are left out without a target or a value", () => {
    expect(kpiLevel("revenue", 1)).toBeNull();
    expect(kpiLevel("csat", null)).toBeNull();
  });
});

describe("seasons (KPI 14)", () => {
  it("fill the next season that has not started", () => {
    expect(nextSeason("2027-03-01", DEFAULT_SEASONS)).toEqual({
      name: "spring",
      from: "2027-04-01",
      to: "2027-06-15",
    });
    expect(nextSeason("2027-05-15", DEFAULT_SEASONS)?.name).toBe("autumn");
    expect(nextSeason("2027-11-18", DEFAULT_SEASONS)).toEqual({
      name: "spring",
      from: "2028-04-01",
      to: "2028-06-15",
    });
  });

  it("are the firm's own when valid", () => {
    expect(
      kpiSeasons({
        kpi: {
          seasons: [
            { name: "spring", from: "03-15", to: "05-31" },
            { name: "winter", from: "01-01", to: "02-01" },
            { name: "autumn", from: "10-31", to: "09-01" },
          ],
        },
      }),
    ).toEqual([{ name: "spring", from: "03-15", to: "05-31" }]);
    expect(kpiSeasons({})).toEqual(DEFAULT_SEASONS);
    expect(prebookingSnapshotKey("autumn")).toBe("kpi14_prebooking_autumn");
  });
});
