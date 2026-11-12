import { describe, expect, it } from "vitest";
import {
  followUpTimes,
  nextCheckStep,
  type AvailabilityStatus,
  type CheckEvent,
} from "./stateMachine";

describe("the availability check's answers (F3)", () => {
  it("JA confirms the visit and thanks the customer", () => {
    expect(nextCheckStep("pending", "yes")).toEqual({
      status: "confirmed",
      actions: ["confirm_visit", "reply_yes"],
    });
  });

  it("NEJ cancels, sends the rebooking link and offers the time to the waitlist", () => {
    expect(nextCheckStep("pending", "no")).toEqual({
      status: "declined",
      actions: ["cancel_visit", "reply_no", "offer_to_waitlist"],
    });
  });

  it("ÄNDRA makes a task and a receipt, and leaves the visit as it is", () => {
    expect(nextCheckStep("pending", "change")).toEqual({
      status: "change_requested",
      actions: ["change_task", "reply_change"],
    });
  });

  it("no answer gives one reminder, then a task to call, never a cancellation", () => {
    expect(nextCheckStep("pending", "reminder_due")).toEqual({
      status: "pending",
      actions: ["send_reminder"],
    });
    const escalated = nextCheckStep("pending", "escalation_due");
    expect(escalated).toEqual({ status: "no_reply", actions: ["call_task", "mark_unconfirmed"] });
    expect(escalated?.actions).not.toContain("cancel_visit");
  });

  it("a late answer after the task still counts and closes the task", () => {
    expect(nextCheckStep("no_reply", "yes")).toEqual({
      status: "confirmed",
      actions: ["confirm_visit", "reply_yes", "close_call_task"],
    });
    expect(nextCheckStep("no_reply", "no")?.actions).toEqual([
      "cancel_visit",
      "reply_no",
      "offer_to_waitlist",
      "close_call_task",
    ]);
    expect(nextCheckStep("no_reply", "change")?.status).toBe("change_requested");
  });

  const settled: AvailabilityStatus[] = [
    "not_sent",
    "skipped",
    "confirmed",
    "declined",
    "change_requested",
  ];
  const events: CheckEvent[] = ["yes", "no", "change", "reminder_due", "escalation_due"];
  it.each(settled)("nothing happens to a check that is %s", (status) => {
    for (const event of events) expect(nextCheckStep(status, event)).toBeNull();
  });

  it("an answered or escalated check gets no reminder or second task", () => {
    expect(nextCheckStep("no_reply", "reminder_due")).toBeNull();
    expect(nextCheckStep("no_reply", "escalation_due")).toBeNull();
  });
});

describe("when the reminder and the task come", () => {
  const nov = (day: number, time: string) =>
    new Date(`2026-11-${String(day).padStart(2, "0")}T${time}:00+01:00`);

  const cases: [string, Date, Date | null, Date][] = [
    [
      "check 10:00: reminder 14:00, task 18:00",
      nov(17, "10:00"),
      nov(17, "14:00"),
      nov(17, "18:00"),
    ],
    [
      "check 08:00: reminder 12:00, task 18:00",
      nov(17, "08:00"),
      nov(17, "12:00"),
      nov(17, "18:00"),
    ],
    [
      "Friday 12:00 for a Monday: reminder 16:00, task Friday 18:00",
      nov(20, "12:00"),
      nov(20, "16:00"),
      nov(20, "18:00"),
    ],
    [
      "check 14:00: reminder 18:00, task two hours later",
      nov(17, "14:00"),
      nov(17, "18:00"),
      nov(17, "20:00"),
    ],
    [
      "check 15:00: reminder 19:00, task 21:00",
      nov(17, "15:00"),
      nov(17, "19:00"),
      nov(17, "21:00"),
    ],
    [
      "check 16:59: reminder 20:59, task 22:59",
      nov(17, "16:59"),
      nov(17, "20:59"),
      nov(17, "22:59"),
    ],
    ["check 17:00: no reminder at 21:00, task 19:00", nov(17, "17:00"), null, nov(17, "19:00")],
    [
      "check 18:00 for an early visit: no reminder, task 20:00",
      nov(17, "18:00"),
      null,
      nov(17, "20:00"),
    ],
    ["check 20:59: no reminder, task 22:59", nov(17, "20:59"), null, nov(17, "22:59")],
  ];

  it.each(cases)("%s", (_name, sentAt, reminder, escalation) => {
    expect(followUpTimes(sentAt)).toEqual({ reminder, escalation });
  });

  it("follows Stockholm time in summer", () => {
    expect(followUpTimes(new Date("2027-06-15T10:00:00+02:00"))).toEqual({
      reminder: new Date("2027-06-15T14:00:00+02:00"),
      escalation: new Date("2027-06-15T18:00:00+02:00"),
    });
  });
});
