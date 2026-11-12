import { describe, expect, it } from "vitest";
import { DEFAULT_BOOKING_SETTINGS } from "../booking/settings";
import {
  cancelBy,
  dayMonth,
  etaSendTime,
  etaWindow,
  firstName,
  promisedWindow,
  surveyAllowed,
  surveyFollowUp,
  surveySendTime,
  weekdayShort,
} from "./timing";

// 2026-10-21 is a Wednesday in summer time (UTC+2); 2026-11-12 a Thursday in winter (UTC+1).
const summer = (t: string) => new Date(`2026-10-21T${t}+02:00`);
const winter = (t: string) => new Date(`2026-11-12T${t}+01:00`);

describe("flow timing", () => {
  it("reads dates and windows the way the sms do", () => {
    expect(weekdayShort(summer("09:00"))).toBe("ons");
    expect(dayMonth(summer("09:00"))).toBe("21/10");
    const windows = DEFAULT_BOOKING_SETTINGS.windows;
    expect(promisedWindow(summer("08:00"), summer("10:00"), windows)).toBe("08–12");
    expect(promisedWindow(summer("13:30"), summer("15:30"), windows)).toBe("12–16");
    // Outside every window: the visit's own times.
    expect(promisedWindow(summer("06:30"), summer("07:45"), windows)).toBe("06:30–07:45");
  });

  it("F5 goes out at 07:00 on the day of the visit, in summer and winter time", () => {
    expect(etaSendTime(summer("13:00"))).toEqual(summer("07:00"));
    expect(etaSendTime(winter("08:00"))).toEqual(winter("07:00"));
  });

  it("F5's window is the planned start to the nearest quarter, give or take an hour", () => {
    expect(etaWindow(winter("10:07"))).toEqual({ from: "09:00", to: "11:00" });
    expect(etaWindow(winter("10:08"))).toEqual({ from: "09:15", to: "11:15" });
  });

  it("F9 goes out 18 hours after done, within 10:00–19:00", () => {
    // 18 h after 15:00 is 09:00: moved to 10:00.
    expect(surveySendTime(winter("15:00"))).toEqual(new Date("2026-11-13T10:00:00+01:00"));
    expect(surveySendTime(winter("17:30"))).toEqual(new Date("2026-11-13T11:30:00+01:00"));
    // 18 h after 02:00 is 20:00: moved to 10:00 the next day.
    expect(surveySendTime(winter("02:00"))).toEqual(new Date("2026-11-13T10:00:00+01:00"));
    expect(surveySendTime(winter("00:59"))).toEqual(new Date("2026-11-12T18:59:00+01:00"));
  });

  it("F9 waits 90 days between questions and follows up by score", () => {
    const now = winter("12:00");
    expect(surveyAllowed(null, now)).toBe(true);
    expect(surveyAllowed(new Date(now.getTime() - 89 * 86_400_000), now)).toBe(false);
    expect(surveyAllowed(new Date(now.getTime() - 90 * 86_400_000), now)).toBe(true);
    expect([1, 2, 3, 4, 5].map(surveyFollowUp)).toEqual([
      "call_back",
      "call_back",
      "call_back",
      "review",
      "review",
    ]);
  });

  it("writes the free cancellation limit and first names", () => {
    expect(cancelBy(summer("12:00"), 24)).toBe("tis 20/10 kl 12");
    expect(firstName("  Christoffer  Andersson ")).toBe("Christoffer");
  });
});
