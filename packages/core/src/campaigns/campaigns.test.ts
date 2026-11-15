import { describe, expect, it } from "vitest";
import { actorMay, initialStatus, nextStatus } from "../booking/stateMachine";
import { stockholmInstant } from "../time";
import {
  chooseSlot,
  dayOfIsoWeek,
  isoWeekOf,
  nextRound,
  nextSendAt,
  targetWeek,
} from "./proposeSlot";
import {
  looksLikeLayUp,
  looksLikeSpringService,
  springSegment,
  type SpringCandidate,
} from "./segment";

const base: SpringCandidate = {
  boatSold: false,
  optedOut: false,
  openLowRating: false,
  hasPhone: true,
  hasEmail: false,
  lastSpring: new Date("2026-04-21T06:00:00Z"),
  laidUpLastAutumn: true,
  bookedThisSpring: false,
};

describe("the spring campaign's segments", () => {
  it("puts last spring's service in A, a lay-up without one in B, and others in none", () => {
    expect(springSegment(base)).toEqual({ segment: "A" });
    expect(springSegment({ ...base, lastSpring: null })).toEqual({ segment: "B" });
    expect(springSegment({ ...base, lastSpring: null, laidUpLastAutumn: false })).toBeNull();
  });

  it("leaves out sold boats, booked ones, open low ratings, STOPP and no way to reach", () => {
    expect(springSegment({ ...base, boatSold: true })).toEqual({ excluded: "sold" });
    expect(springSegment({ ...base, bookedThisSpring: true })).toEqual({ excluded: "booked" });
    expect(springSegment({ ...base, openLowRating: true })).toEqual({ excluded: "low_rating" });
    expect(springSegment({ ...base, optedOut: true, hasEmail: true })).toEqual({
      excluded: "opted_out",
    });
    expect(springSegment({ ...base, hasPhone: false })).toEqual({ excluded: "no_contact" });
    // Without a mobile, e-mail does.
    expect(springSegment({ ...base, hasPhone: false, hasEmail: true })).toEqual({ segment: "A" });
  });

  it("knows spring and lay-up services by their names", () => {
    expect(looksLikeSpringService("Vårservice och sjösättningskontroll")).toBe(true);
    expect(looksLikeSpringService("Felsökning")).toBe(false);
    expect(looksLikeLayUp("Vinterkonservering")).toBe(true);
  });
});

describe("the held time", () => {
  it("is in the same ISO week as last year, preferring last year's weekday", () => {
    expect(isoWeekOf("2026-04-21")).toEqual({ year: 2026, week: 17 });
    expect(isoWeekOf("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(dayOfIsoWeek(2027, 17, 1)).toBe("2027-04-26");
    expect(
      targetWeek({
        year: 2027,
        lastSpring: new Date("2026-04-21T06:00:00Z"), // a Tuesday in week 17
        launchDate: null,
        defaultWeek: 16,
      }),
    ).toEqual({ monday: "2027-04-26", weekday: 2, lastWeek: 17 });
  });

  it("without last year's visit is the week before the launch, else the campaign's week", () => {
    expect(
      targetWeek({ year: 2027, lastSpring: null, launchDate: "2027-05-01", defaultWeek: 16 }),
    ).toEqual({ monday: "2027-04-19", weekday: null, lastWeek: null });
    expect(
      targetWeek({ year: 2027, lastSpring: null, launchDate: "2026-05-01", defaultWeek: 16 }),
    ).toEqual({ monday: "2027-04-19", weekday: null, lastWeek: null });
  });

  it("is a marina day first, then last year's weekday, then the earliest, in the week only", () => {
    const at = (day: string, marinaDay = false) => ({
      day,
      marinaDay,
      start: stockholmInstant(day, "08:00"),
    });
    const week = { monday: "2027-04-26", weekday: 2, lastWeek: 17 };
    expect(
      chooseSlot([at("2027-04-26"), at("2027-04-27"), at("2027-04-29", true)], week)?.day,
    ).toBe("2027-04-29");
    expect(chooseSlot([at("2027-04-26"), at("2027-04-27")], week)?.day).toBe("2027-04-27");
    expect(chooseSlot([at("2027-04-28"), at("2027-04-26")], { ...week, weekday: null })?.day).toBe(
      "2027-04-26",
    );
    // The next week, or the weekend, is not the week.
    expect(chooseSlot([at("2027-05-03"), at("2027-05-01", true)], week)).toBeNull();
  });
});

describe("the sends", () => {
  it("go out Tuesday to Thursday at 18:30", () => {
    // Sunday 10 January 2027: the first round is on Tuesday.
    expect(nextSendAt(stockholmInstant("2027-01-10", "18:30"))).toEqual(
      stockholmInstant("2027-01-12", "18:30"),
    );
    expect(nextSendAt(stockholmInstant("2027-01-12", "18:30"))).toEqual(
      stockholmInstant("2027-01-12", "18:30"),
    );
    expect(nextSendAt(stockholmInstant("2027-01-14", "19:00"))).toEqual(
      stockholmInstant("2027-01-19", "18:30"),
    );
  });

  it("take a round's recipients marina by marina", () => {
    const r = (locationId: string | null, when: string) => ({ locationId, when });
    expect(
      nextRound(
        [r("b", "2027-04-20"), r(null, "2027-04-01"), r("a", "2027-04-27"), r("a", "2027-04-19")],
        3,
      ),
    ).toEqual([r("a", "2027-04-19"), r("a", "2027-04-27"), r("b", "2027-04-20")]);
  });
});

describe("a visit held by a campaign", () => {
  it("is reserved, booked on JA by the system, and may be released", () => {
    expect(initialStatus({ needsApproval: false, partsMissing: false, reserved: true })).toBe(
      "reserved",
    );
    expect(nextStatus("reserved", "accept")).toBe("booked");
    expect(nextStatus("reserved", "cancel")).toBe("cancelled");
    expect(nextStatus("reserved", "reschedule")).toBe("reserved");
    expect(() => nextStatus("reserved", "start")).toThrow();
    expect(() => nextStatus("booked", "accept")).toThrow();
    expect(actorMay("system", "accept")).toBe(true);
    expect(actorMay("customer", "accept")).toBe(false);
  });
});
