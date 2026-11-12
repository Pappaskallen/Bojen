/**
 * What happens after the availability check (F3) has gone out (byggplan step 4.2, spec part
 * 1, chapter 7). Pure: the worker passes what happened and carries out the actions.
 *
 *   pending ──yes──▶ confirmed          the visit is confirmed, the customer gets a receipt
 *   pending ──no──▶ declined            the visit is cancelled, free of charge; a rebooking
 *                                       link goes out and the time is offered to the waitlist
 *   pending ──change──▶ change_requested   a task with high priority, and a receipt
 *   pending ──reminder_due──▶ pending   one reminder
 *   pending ──escalation_due──▶ no_reply   a task to call the customer; the visit is marked
 *                                       unconfirmed (yellow). Never cancelled automatically:
 *                                       the customer does not have to be there.
 *
 * An answer that comes after the escalation still counts, and closes the task to call.
 */
import { stockholmDate, stockholmInstant } from "../time";
import { stockholmTime } from "../flows/timing";

export type AvailabilityStatus =
  "not_sent" | "skipped" | "pending" | "confirmed" | "declined" | "change_requested" | "no_reply";

export type CheckEvent = "yes" | "no" | "change" | "reminder_due" | "escalation_due";

export type CheckAction =
  | "confirm_visit"
  | "reply_yes"
  | "cancel_visit"
  | "reply_no"
  | "offer_to_waitlist"
  | "change_task"
  | "reply_change"
  | "send_reminder"
  | "call_task"
  | "mark_unconfirmed"
  | "close_call_task";

export interface CheckStep {
  status: AvailabilityStatus;
  actions: readonly CheckAction[];
}

const ANSWERS: Record<"yes" | "no" | "change", CheckStep> = {
  yes: { status: "confirmed", actions: ["confirm_visit", "reply_yes"] },
  no: { status: "declined", actions: ["cancel_visit", "reply_no", "offer_to_waitlist"] },
  change: { status: "change_requested", actions: ["change_task", "reply_change"] },
};

/** The next state and what to do, or null when the event changes nothing. */
export function nextCheckStep(status: AvailabilityStatus, event: CheckEvent): CheckStep | null {
  if (status === "pending") {
    if (event === "reminder_due") return { status: "pending", actions: ["send_reminder"] };
    if (event === "escalation_due") {
      return { status: "no_reply", actions: ["call_task", "mark_unconfirmed"] };
    }
    return ANSWERS[event];
  }
  if (status === "no_reply" && (event === "yes" || event === "no" || event === "change")) {
    const answer = ANSWERS[event];
    return { status: answer.status, actions: [...answer.actions, "close_call_task"] };
  }
  return null;
}

const HOUR = 3_600_000;
const quiet = (instant: Date) => {
  const time = stockholmTime(instant);
  return time >= "21:00" || time < "08:00";
};

export interface FollowUpTimes {
  /** Null when four hours later is in the quiet hours: then there is no reminder. */
  reminder: Date | null;
  escalation: Date;
}

/**
 * When the reminder and the task to call come, counted from when the check went out
 * (decided with Robert 2026-11-12; the spec's fixed times collide for Monday, early and
 * afternoon visits):
 *
 *  - The reminder four hours after the check, unless that is in the quiet hours 21:00–08:00.
 *  - The task at 18:00 the day the check went out, but at the earliest two hours after the
 *    reminder, or two hours after the check when there is no reminder.
 */
export function followUpTimes(checkSentAt: Date): FollowUpTimes {
  const fourHoursLater = new Date(checkSentAt.getTime() + 4 * HOUR);
  const reminder = quiet(fourHoursLater) ? null : fourHoursLater;
  const sixOClock = stockholmInstant(stockholmDate(checkSentAt), "18:00");
  const earliest = new Date((reminder ?? checkSentAt).getTime() + 2 * HOUR);
  return { reminder, escalation: earliest > sixOClock ? earliest : sixOClock };
}
