import { availabilityCheckTime, stockholmDate, sv, type CheckPlan } from "@bojen/core";
import {
  checkContext,
  queueSms,
  scheduleJob,
  skipAvailabilityCheck,
  startAvailabilityCheck,
  visitContext,
  type VisitContext,
} from "@bojen/db";
import { type FlowDeps, visitVars } from "./deps";

export const CHECK_TASK = "visit_check";

/** A job may run a little after its time; later than this it belongs to an older booking. */
const SLACK_MS = 60_000;

async function planFor(deps: FlowDeps, visit: VisitContext) {
  const context = await checkContext(deps.db, visit.tenantId, visit.visitId);
  if (!context) return null;
  const plan: CheckPlan = availabilityCheckTime({
    start: visit.start,
    bookedAt: context.bookedAt,
    urgency: context.urgency,
  });
  return { context, plan };
}

/**
 * Puts the availability check (F3) in for its time, or moves it there after a new time
 * (step 4.1). A visit that gets no check, booked within 24 hours or an emergency, is marked
 * `skipped`: it counts as confirmed.
 */
export async function scheduleCheck(
  deps: FlowDeps,
  visit: VisitContext,
): Promise<"scheduled" | "skipped"> {
  if (visit.status !== "booked") return "skipped";
  const planned = await planFor(deps, visit);
  if (!planned || planned.context.availabilityStatus !== "not_sent") return "skipped";
  if (!planned.plan.send) {
    await skipAvailabilityCheck(deps.db, visit.tenantId, visit.visitId);
    return "skipped";
  }
  await scheduleJob(
    deps.db,
    CHECK_TASK,
    { tenantId: visit.tenantId, visitId: visit.visitId },
    planned.plan.at,
    `check:${visit.visitId}`,
  );
  return "scheduled";
}

/**
 * F3, the check itself: "is the boat where we think, with the key where you said?". Only
 * for a visit that is still `booked` and unchecked, whose customer has a mobile. The time is
 * worked out again, so a job left from before a reschedule sends nothing. The answer is
 * handled by step 4.2.
 */
export async function sendAvailabilityCheck(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
): Promise<"sent" | "skipped"> {
  const visit = await visitContext(deps.db, tenantId, visitId);
  if (visit?.status !== "booked" || !visit.customer.phone) return "skipped";
  const now = deps.now();
  // A job that runs late, on the day of the visit, would say "i morgon" about today.
  if (stockholmDate(now) >= stockholmDate(visit.start)) return "skipped";
  const planned = await planFor(deps, visit);
  if (!planned?.plan.send || planned.plan.at.getTime() > now.getTime() + SLACK_MS) return "skipped";
  // Without a known place the question cannot be asked; the visit counts as unchecked.
  if (!visit.place) {
    await skipAvailabilityCheck(deps.db, tenantId, visitId);
    return "skipped";
  }
  if (!(await startAvailabilityCheck(deps.db, tenantId, visitId))) return "skipped";

  const vars = visitVars(visit);
  const target = {
    tenantId,
    to: visit.customer.phone,
    customerId: visit.customer.id,
    visitId,
    ...(visit.boat ? { boatId: visit.boat.id } : {}),
  };
  const common = {
    firstName: vars.firstName,
    day: sv.flows.checkDay[planned.plan.day],
    window: vars.window,
    boat: vars.boat,
    placeShort: vars.placeShort,
    firm: vars.firm,
  };
  const code = planned.context.hasGateCode;
  if (visit.place?.mode === "water") {
    const { placeShort, ...rest } = common;
    await queueSms(deps, target, code ? "f3_check_water_code" : "f3_check_water", {
      ...rest,
      place: [placeShort, visit.place.spotId].filter(Boolean).join(" "),
    });
  } else {
    await queueSms(deps, target, code ? "f3_check_land_code" : "f3_check_land", common);
  }
  return "sent";
}
