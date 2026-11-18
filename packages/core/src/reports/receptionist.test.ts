import { describe, expect, it } from "vitest";
import { receptionistSettings } from "../voice/settings";
import { callFilter, receptionistKpis, type CallRecord } from "./receptionist";

// Summer time: Stockholm is UTC+2. Monday 5 April 2027.
const at = (local: string) => new Date(`2027-04-${local}:00+02:00`);
const office = receptionistSettings({}).officeHours;

describe("the receptionist's KPIs (21–24)", () => {
  it("count the calls without spam, conversion, transfers and calls outside office hours", () => {
    const calls: CallRecord[] = [
      { startedAt: at("05T08:00"), outcome: "booked", intent: "book" },
      { startedAt: at("05T18:30"), outcome: "booked", intent: null }, // evening
      { startedAt: at("05T12:00"), outcome: "message", intent: "book" },
      { startedAt: at("05T13:00"), outcome: "transferred", intent: "emergency" },
      { startedAt: at("05T14:00"), outcome: "message", intent: "question" },
      { startedAt: at("10T10:00"), outcome: null, intent: null }, // Saturday
      { startedAt: at("05T09:00"), outcome: "spam", intent: "other" },
    ];
    expect(receptionistKpis(calls, office)).toEqual({
      calls: 6,
      bookings: 2,
      transferred: 1,
      // Booked 2 of the 4 who wanted a time or had an emergency.
      conversion: 0.5,
      transferShare: 1 / 6,
      outsideHours: 2 / 6,
    });
  });

  it("are empty without calls", () => {
    expect(receptionistKpis([], office)).toMatchObject({
      calls: 0,
      conversion: null,
      transferShare: null,
      outsideHours: null,
    });
  });

  it("follow the firm's own office hours", () => {
    const own = receptionistSettings({
      receptionist: { officeHours: [{ days: [1, 2, 3, 4, 5, 6], from: "06:00", to: "20:00" }] },
    });
    expect(own.openingHours).toBe("mån–lör 6–20");
    const evening = [{ startedAt: at("05T18:30"), outcome: "booked" as const, intent: null }];
    expect(receptionistKpis(evening, own.officeHours).outsideHours).toBe(0);
    expect(receptionistKpis(evening, office).outsideHours).toBe(1);
  });

  it("filter the list only on known outcomes", () => {
    expect(callFilter("booked")).toBe("booked");
    expect(callFilter("none")).toBe("none");
    expect(callFilter("x")).toBeNull();
  });
});
