import { etaSendTime, etaWindow, stockholmDate } from "@bojen/core";
import { alreadySent, queueSms, scheduleJob, visitContext, type VisitContext } from "@bojen/db";
import { type FlowDeps, visitVars } from "./deps";

export const ETA_TASK = "visit_eta";

/** Statuses that still get F5. `booked` too, until the 24-hour check (phase 4) confirms visits. */
const STILL_ON = new Set(["booked", "confirmed", "unconfirmed"]);

/**
 * Puts F5 in for 07:00 on the visit's day, or moves it there after a new time. A visit
 * booked after 07:00 on its own day gets no F5: the confirmation has just gone out.
 */
export async function scheduleEta(deps: FlowDeps, visit: VisitContext): Promise<boolean> {
  const at = etaSendTime(visit.start);
  if (at <= deps.now()) return false;
  await scheduleJob(
    deps.db,
    ETA_TASK,
    { tenantId: visit.tenantId, visitId: visit.visitId },
    at,
    `eta:${visit.visitId}`,
  );
  return true;
}

/**
 * F5, the morning sms with the arrival time. Until the route planning of the day view
 * (step 5.5) the time is the planned start, give or take an hour.
 */
export async function sendMorningEta(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
): Promise<"sent" | "skipped"> {
  const visit = await visitContext(deps.db, tenantId, visitId);
  if (!visit || !STILL_ON.has(visit.status) || !visit.customer.phone) return "skipped";
  // A visit moved to another day has its own job for that day.
  if (stockholmDate(visit.start) !== stockholmDate(deps.now())) return "skipped";
  if (await alreadySent(deps.db, tenantId, visitId, "f5_eta")) return "skipped";
  const vars = visitVars(visit);
  const eta = etaWindow(visit.start);
  await queueSms(
    deps,
    {
      tenantId,
      to: visit.customer.phone,
      customerId: visit.customer.id,
      visitId,
      ...(visit.boat ? { boatId: visit.boat.id } : {}),
    },
    "f5_eta",
    {
      mechanicFirstName: vars.mechanicFirstName,
      boat: vars.boat,
      placeShort: vars.placeShort,
      etaFrom: eta.from,
      etaTo: eta.to,
      firm: vars.firm,
    },
  );
  return "sent";
}
