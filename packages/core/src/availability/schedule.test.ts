import { describe, expect, it } from "vitest";
import { availabilityCheckTime, type CheckPlan, type JobUrgency } from "./schedule";

/** Stockholm time in November 2026 (UTC+1). The 16th and the 23rd are Mondays. */
const nov = (day: number, time: string) =>
  new Date(`2026-11-${String(day).padStart(2, "0")}T${time}:00+01:00`);
const send = (at: Date, day: "tomorrow" | "monday" = "tomorrow"): CheckPlan => ({
  send: true,
  at,
  day,
});
const skip = (reason: "emergency" | "booked_late"): CheckPlan => ({ send: false, reason });

const LONG_BEFORE = nov(2, "09:00");

describe("when the availability check goes out (F3)", () => {
  const cases: [string, Date, Date, JobUrgency, CheckPlan][] = [
    // --- The start minus 24 hours ---
    ["Wed 10:00: Tue 10:00", nov(18, "10:00"), LONG_BEFORE, "planned", send(nov(17, "10:00"))],
    ["Wed 13:30: Tue 13:30", nov(18, "13:30"), LONG_BEFORE, "soon", send(nov(17, "13:30"))],
    ["Sat 10:00: Fri 10:00", nov(21, "10:00"), LONG_BEFORE, "planned", send(nov(20, "10:00"))],
    // --- Quiet hours 21:00–08:00 move it to 18:00 the day before the visit ---
    ["Wed 08:00 is not quiet", nov(18, "08:00"), LONG_BEFORE, "planned", send(nov(17, "08:00"))],
    ["Wed 07:59: Tue 18:00", nov(18, "07:59"), LONG_BEFORE, "planned", send(nov(17, "18:00"))],
    ["Tue 07:00: Mon 18:00", nov(17, "07:00"), LONG_BEFORE, "planned", send(nov(16, "18:00"))],
    ["Wed 20:59 is not quiet", nov(18, "20:59"), LONG_BEFORE, "planned", send(nov(17, "20:59"))],
    ["Wed 21:00: Tue 18:00", nov(18, "21:00"), LONG_BEFORE, "planned", send(nov(17, "18:00"))],
    // --- Mondays are checked on Friday at 12 ---
    [
      "Mon 10:00: Fri 12:00",
      nov(23, "10:00"),
      LONG_BEFORE,
      "planned",
      send(nov(20, "12:00"), "monday"),
    ],
    [
      "Mon 07:00: Fri 12:00, not Sunday evening",
      nov(23, "07:00"),
      LONG_BEFORE,
      "planned",
      send(nov(20, "12:00"), "monday"),
    ],
    [
      "Mon 14:00 booked on Saturday: Sun 14:00",
      nov(23, "14:00"),
      nov(21, "10:00"),
      "planned",
      send(nov(22, "14:00")),
    ],
    [
      "Mon 07:00 booked Friday at 12:00 sharp: Sun 18:00",
      nov(23, "07:00"),
      nov(20, "12:00"),
      "planned",
      send(nov(22, "18:00")),
    ],
    [
      "Mon 10:00 booked Friday 11:59: still Fri 12:00",
      nov(23, "10:00"),
      nov(20, "11:59"),
      "planned",
      send(nov(20, "12:00"), "monday"),
    ],
    // --- Booked less than 24 hours before: no check ---
    [
      "booked 23 h 59 min before",
      nov(18, "10:00"),
      nov(17, "10:01"),
      "planned",
      skip("booked_late"),
    ],
    ["booked the same morning", nov(18, "13:00"), nov(18, "08:00"), "planned", skip("booked_late")],
    [
      "booked exactly 24 h before: at once",
      nov(18, "10:00"),
      nov(17, "10:00"),
      "planned",
      send(nov(17, "10:00")),
    ],
    [
      "Mon 10:00 booked Sunday 11:00",
      nov(23, "10:00"),
      nov(22, "11:00"),
      "planned",
      skip("booked_late"),
    ],
    // --- Emergencies are never checked ---
    ["emergency a week ahead", nov(18, "10:00"), LONG_BEFORE, "emergency", skip("emergency")],
    ["emergency on a Monday", nov(23, "10:00"), LONG_BEFORE, "emergency", skip("emergency")],
    // --- The time has passed when the visit is booked ---
    [
      "Wed 23:00 booked Tue 19:00, after 18:00: at once",
      nov(18, "23:00"),
      nov(17, "19:00"),
      "planned",
      send(nov(17, "19:00")),
    ],
    [
      "Wed 23:00 booked Tue 21:30, in the quiet hours: no check",
      nov(18, "23:00"),
      nov(17, "21:30"),
      "planned",
      skip("booked_late"),
    ],
  ];

  it.each(cases)("%s", (_name, start, bookedAt, urgency, expected) => {
    expect(availabilityCheckTime({ start, bookedAt, urgency })).toEqual(expected);
  });

  it("follows Stockholm time in summer and over the change to summer time", () => {
    const booked = new Date("2027-03-01T09:00:00+01:00");
    // June, UTC+2.
    expect(
      availabilityCheckTime({
        start: new Date("2027-06-16T07:30:00+02:00"),
        bookedAt: booked,
        urgency: "planned",
      }),
    ).toEqual(send(new Date("2027-06-15T18:00:00+02:00")));
    // Summer time starts Sunday 28 March 2027. Monday the 29th is checked Friday at 12, UTC+1.
    expect(
      availabilityCheckTime({
        start: new Date("2027-03-29T10:00:00+02:00"),
        bookedAt: booked,
        urgency: "planned",
      }),
    ).toEqual(send(new Date("2027-03-26T12:00:00+01:00"), "monday"));
    // Sunday 08:30 summer time is 24 hours after Saturday 07:30 winter time: quiet, so 18:00.
    expect(
      availabilityCheckTime({
        start: new Date("2027-03-28T08:30:00+02:00"),
        bookedAt: booked,
        urgency: "planned",
      }),
    ).toEqual(send(new Date("2027-03-27T18:00:00+01:00")));
  });
});
