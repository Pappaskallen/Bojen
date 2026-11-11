import { describe, expect, it } from "vitest";
import { checkSlot } from "../scheduling/slot";
import { stockholmInstant } from "../time";
import { DEFAULT_BOOKING_SETTINGS, bookingSettings } from "./settings";
import {
  InvalidTransitionError,
  VISIT_EVENTS,
  VISIT_STATUSES,
  actorMay,
  canTransition,
  customerMayChange,
  initialStatus,
  isFinal,
  nextStatus,
  type VisitEvent,
  type VisitStatus,
} from "./stateMachine";

describe("visit state machine", () => {
  it.each<[VisitStatus, VisitEvent, VisitStatus]>([
    ["pending_approval", "approve", "booked"],
    ["pending_approval", "reject", "cancelled"],
    ["tentative", "parts_arrived", "booked"],
    ["booked", "confirm", "confirmed"],
    ["booked", "mark_unconfirmed", "unconfirmed"],
    ["unconfirmed", "confirm", "confirmed"],
    ["confirmed", "reschedule", "booked"],
    ["unconfirmed", "reschedule", "booked"],
    ["tentative", "reschedule", "tentative"],
    ["pending_approval", "reschedule", "pending_approval"],
    ["booked", "cancel", "cancelled"],
    ["tentative", "cancel", "cancelled"],
    ["confirmed", "start", "in_progress"],
    ["unconfirmed", "start", "in_progress"],
    ["in_progress", "complete", "done"],
    ["in_progress", "report_no_access", "no_access"],
    ["booked", "report_no_access", "no_access"],
  ])("%s --%s--> %s", (from, event, to) => {
    expect(nextStatus(from, event)).toBe(to);
  });

  it.each<[VisitStatus, VisitEvent]>([
    ["booked", "approve"],
    ["tentative", "confirm"],
    ["pending_approval", "start"],
    ["tentative", "start"],
    ["booked", "complete"],
    ["in_progress", "cancel"],
    ["in_progress", "reschedule"],
    ["confirmed", "mark_unconfirmed"],
    ["done", "cancel"],
    ["cancelled", "confirm"],
    ["cancelled", "reschedule"],
    ["no_access", "start"],
  ])("refuses %s --%s-->", (from, event) => {
    expect(canTransition(from, event)).toBe(false);
    expect(() => nextStatus(from, event)).toThrow(InvalidTransitionError);
  });

  it("lets nothing leave a final status", () => {
    for (const status of VISIT_STATUSES.filter(isFinal)) {
      for (const event of VISIT_EVENTS) expect(canTransition(status, event)).toBe(false);
    }
  });

  it("makes an approved visit tentative while parts are missing", () => {
    expect(nextStatus("pending_approval", "approve", { partsMissing: true })).toBe("tentative");
  });

  it("chooses the first status of a booking", () => {
    expect(initialStatus({ needsApproval: false, partsMissing: false })).toBe("booked");
    expect(initialStatus({ needsApproval: false, partsMissing: true })).toBe("tentative");
    expect(initialStatus({ needsApproval: true, partsMissing: true })).toBe("pending_approval");
  });

  it("lets customers only confirm, reschedule and cancel", () => {
    const customer = VISIT_EVENTS.filter((e) => actorMay("customer", e));
    expect(customer).toEqual(["confirm", "reschedule", "cancel"]);
    expect(actorMay("system", "approve")).toBe(false);
    expect(VISIT_EVENTS.every((e) => actorMay("staff", e))).toBe(true);
  });

  it("stops customer changes 48 hours before the start", () => {
    const start = new Date("2027-04-20T06:00:00Z");
    expect(customerMayChange(start, new Date("2027-04-18T06:00:00Z"), 48)).toBe(true);
    expect(customerMayChange(start, new Date("2027-04-18T06:00:01Z"), 48)).toBe(false);
  });
});

describe("checkSlot", () => {
  const day = "2027-04-20"; // Tuesday
  const base = {
    mechanicId: "jonas",
    start: stockholmInstant(day, "10:00"),
    durationMinutes: 120,
    bufferMinutes: 15,
    schedule: [{ mechanicId: "jonas", weekday: 2, start: "07:00", end: "17:00" }] as const,
    blocks: [],
    visits: [],
  };
  const busy = (from: string, to: string, mechanicId = "jonas") => ({
    mechanicId,
    start: stockholmInstant(day, from),
    end: stockholmInstant(day, to),
  });

  it.each([
    ["a free time", {}, null],
    ["before work", { start: stockholmInstant(day, "06:30") }, "outside_working_hours"],
    [
      "running past the end of the day",
      { start: stockholmInstant(day, "16:00") },
      "outside_working_hours",
    ],
    ["on a day off", { start: stockholmInstant("2027-04-24", "10:00") }, "outside_working_hours"],
    ["in blocked time", { blocks: [busy("11:00", "11:30")] }, "blocked"],
    ["overlapping a visit", { visits: [busy("11:00", "13:00")] }, "overlaps_visit"],
    ["inside another visit's buffer", { visits: [busy("08:00", "09:50")] }, "overlaps_visit"],
    ["exactly one buffer after a visit", { visits: [busy("08:00", "09:45")] }, null],
    ["next to another mechanic's visit", { visits: [busy("10:00", "12:00", "elin")] }, null],
  ] as const)("%s", (_name, overrides, expected) => {
    expect(checkSlot({ ...base, ...overrides })).toBe(expected);
  });
});

describe("bookingSettings", () => {
  it("uses the defaults when nothing is set", () => {
    expect(bookingSettings({})).toEqual(DEFAULT_BOOKING_SETTINGS);
    expect(bookingSettings(null)).toEqual(DEFAULT_BOOKING_SETTINGS);
  });

  it("reads valid values and ignores invalid ones", () => {
    const settings = bookingSettings({
      booking: {
        windows: [{ start: "07:00", end: "11:00" }],
        bufferMinutes: 20,
        maxExtraDriveMinutes: -5,
        marinaDayDiscount: { kind: "percent", percent: 10 },
        customerChangeCutoffHours: "24",
      },
    });
    expect(settings).toEqual({
      ...DEFAULT_BOOKING_SETTINGS,
      windows: [{ start: "07:00", end: "11:00" }],
      bufferMinutes: 20,
      marinaDayDiscount: { kind: "percent", percent: 10 },
    });
    expect(
      bookingSettings({ booking: { windows: [{ start: "12:00", end: "08:00" }] } }).windows,
    ).toEqual(DEFAULT_BOOKING_SETTINGS.windows);
  });
});
