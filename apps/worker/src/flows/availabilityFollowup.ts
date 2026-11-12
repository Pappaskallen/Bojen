import {
  availabilityCheckTime,
  followUpTimes,
  nextCheckStep,
  sv,
  type AvailabilityStatus,
  type CheckAction,
  type CheckEvent,
} from "@bojen/core";
import {
  changeBooking,
  checkContext,
  closeCallTask,
  createTask,
  moveAvailability,
  queueSms,
  scheduleJob,
  visitContext,
  type Database,
  type VisitContext,
} from "@bojen/db";
import { type FlowDeps, visitVars } from "./deps";

export const REMINDER_TASK = "visit_check_reminder";
export const ESCALATION_TASK = "visit_check_escalation";

/**
 * After the check has gone out (step 4.2): the reminder four hours later and the task to
 * call, at the times `followUpTimes` gives. The jobs are keyed on the visit, so a new check
 * after a reschedule replaces them.
 */
export async function scheduleFollowUps(deps: FlowDeps, visit: VisitContext, checkSentAt: Date) {
  const times = followUpTimes(checkSentAt);
  const payload = { tenantId: visit.tenantId, visitId: visit.visitId };
  if (times.reminder) {
    await scheduleJob(deps.db, REMINDER_TASK, payload, times.reminder, `remind:${visit.visitId}`);
  }
  await scheduleJob(
    deps.db,
    ESCALATION_TASK,
    payload,
    times.escalation,
    `escalate:${visit.visitId}`,
  );
}

export type CheckOutcome = "ignored" | AvailabilityStatus;

/**
 * One event in the life of a check: an answer from the customer (JA, NEJ, ÄNDRA, also read
 * out of free text by step 3.2), or the reminder or the escalation coming due. The state
 * moves first, and only if it was where the event expects, so nothing is done twice; the
 * actions follow in the same transaction.
 *
 * `key` makes the booking changes idempotent: the id of the answer or of the job's round.
 */
export async function handleCheckEvent(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  event: CheckEvent,
  key: string,
): Promise<CheckOutcome> {
  return deps.db.transaction(async (tx) => {
    const inTx: FlowDeps = { ...deps, db: tx as unknown as Database };
    const context = await checkContext(inTx.db, tenantId, visitId);
    const visit = await visitContext(inTx.db, tenantId, visitId);
    if (!context || !visit) return "ignored";
    const now = deps.now();
    // After the visit has started nothing here applies any more.
    if (visit.start <= now) return "ignored";

    // A visit that staff have cancelled, confirmed or started in the meantime is left alone.
    const timer = event === "reminder_due" || event === "escalation_due";
    if (visit.status !== "booked" && (timer || visit.status !== "unconfirmed")) return "ignored";

    const from = context.availabilityStatus as AvailabilityStatus;
    const step = nextCheckStep(from, event);
    if (!step) return "ignored";
    if (step.status !== from) {
      const moved = await moveAvailability(inTx.db, tenantId, visitId, [from], step.status);
      if (!moved) return "ignored";
    }

    const vars = visitVars(visit);
    const phone = visit.customer.phone;
    const target = {
      tenantId,
      customerId: visit.customer.id,
      visitId,
      ...(visit.boat ? { boatId: visit.boat.id } : {}),
    };
    const system = (suffix: string) => ({
      tenantId,
      actor: { type: "system" as const, id: null },
      // The booking time is part of the key, so a new check after a reschedule acts again.
      idempotencyKey: `check:${key}:${String(context.bookedAt.getTime())}:${suffix}`,
    });
    const booking = { db: inTx.db, now: deps.now };

    const run: Record<CheckAction, () => Promise<unknown>> = {
      confirm_visit: () => changeBooking(booking, system("confirm"), visitId, { event: "confirm" }),
      reply_yes: async () => {
        if (phone) await queueSms(inTx, { ...target, to: phone }, "f3_reply_yes", {});
      },
      // Free of charge although the limit has passed: we asked (decided with Robert).
      cancel_visit: () =>
        changeBooking(booking, system("cancel"), visitId, {
          event: "cancel",
          reason: "availability_check",
        }),
      reply_no: async () => {
        if (!phone) return;
        await queueSms(inTx, { ...target, to: phone }, "f3_reply_no", {
          link: await deps.link(visit, "rebook"),
          firm: vars.firm,
        });
      },
      // The cancellation's own event, `visit.cancel`, starts F4 (step 4.3).
      offer_to_waitlist: () => Promise.resolve(),
      change_task: () =>
        createTask(inTx.db, {
          tenantId,
          type: "change_request",
          priority: "high",
          title: sv.flows.changeRequest(visit.customer.name),
          customerId: visit.customer.id,
          jobId: visit.jobId,
          visitId,
        }),
      reply_change: async () => {
        if (!phone) return;
        await queueSms(inTx, { ...target, to: phone }, "f3_reply_change", {
          mechanicFirstName: vars.mechanicFirstName,
        });
      },
      send_reminder: async () => {
        if (!phone) return;
        const plan = availabilityCheckTime({
          start: visit.start,
          bookedAt: context.bookedAt,
          urgency: context.urgency,
        });
        await queueSms(inTx, { ...target, to: phone }, "f3_reminder", {
          day: sv.flows.checkDayInline[plan.send ? plan.day : "tomorrow"],
          window: vars.window,
          placeShort: vars.placeShort,
        });
      },
      call_task: () =>
        createTask(inTx.db, {
          tenantId,
          type: "call_back",
          priority: "high",
          title: sv.flows.callUnconfirmed(visit.customer.name),
          customerId: visit.customer.id,
          jobId: visit.jobId,
          visitId,
          dueAt: visit.start,
        }),
      mark_unconfirmed: () =>
        changeBooking(booking, system("unconfirmed"), visitId, { event: "mark_unconfirmed" }),
      close_call_task: () => closeCallTask(inTx.db, tenantId, visitId, now),
    };
    for (const action of step.actions) await run[action]();
    return step.status;
  });
}
