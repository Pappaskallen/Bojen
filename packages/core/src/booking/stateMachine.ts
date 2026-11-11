/**
 * The life of a visit (byggplan step 2.4, spec 6.1 and flows F2–F4).
 *
 *   tentative ──parts_arrived──▶ booked ──confirm──▶ confirmed
 *   pending_approval ──approve──▶ booked (or tentative while parts are missing)
 *   booked ──mark_unconfirmed──▶ unconfirmed ──confirm──▶ confirmed
 *   booked | confirmed | unconfirmed ──start──▶ in_progress ──complete──▶ done
 *   … ──cancel──▶ cancelled, … ──report_no_access──▶ no_access
 *
 * `done`, `cancelled` and `no_access` are final. Rescheduling keeps a tentative or
 * pending visit as it is and sends a confirmed or unconfirmed visit back to `booked`,
 * since the customer has not confirmed the new time.
 */

export const VISIT_STATUSES = [
  "tentative",
  "pending_approval",
  "booked",
  "confirmed",
  "unconfirmed",
  "in_progress",
  "done",
  "cancelled",
  "no_access",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_EVENTS = [
  "approve",
  "reject",
  "parts_arrived",
  "confirm",
  "mark_unconfirmed",
  "reschedule",
  "cancel",
  "start",
  "complete",
  "report_no_access",
] as const;
export type VisitEvent = (typeof VISIT_EVENTS)[number];

export type ActorType = "customer" | "staff" | "system";

const BEFORE_WORK = [
  "tentative",
  "pending_approval",
  "booked",
  "confirmed",
  "unconfirmed",
] as const;
const SCHEDULED = ["booked", "confirmed", "unconfirmed"] as const;

const all = <S extends VisitStatus>(from: readonly S[], to: VisitStatus) =>
  Object.fromEntries(from.map((s) => [s, to])) as Partial<Record<VisitStatus, VisitStatus>>;

const TRANSITIONS: Record<VisitEvent, Partial<Record<VisitStatus, VisitStatus>>> = {
  approve: { pending_approval: "booked" },
  reject: { pending_approval: "cancelled" },
  parts_arrived: { tentative: "booked" },
  confirm: { booked: "confirmed", unconfirmed: "confirmed" },
  mark_unconfirmed: { booked: "unconfirmed" },
  reschedule: {
    tentative: "tentative",
    pending_approval: "pending_approval",
    booked: "booked",
    confirmed: "booked",
    unconfirmed: "booked",
  },
  cancel: all(BEFORE_WORK, "cancelled"),
  start: all(SCHEDULED, "in_progress"),
  complete: { in_progress: "done" },
  report_no_access: { ...all(SCHEDULED, "no_access"), in_progress: "no_access" },
};

/** Who may trigger each event. Staff may do everything. */
const ALLOWED: Record<Exclude<ActorType, "staff">, readonly VisitEvent[]> = {
  customer: ["confirm", "reschedule", "cancel"],
  // The system confirms on a clear YES by sms (F3) and moves tentative visits on (F2).
  system: ["confirm", "parts_arrived", "mark_unconfirmed", "cancel"],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly status: VisitStatus,
    readonly event: VisitEvent,
  ) {
    super(`A visit that is ${status} cannot ${event}`);
    this.name = "InvalidTransitionError";
  }
}

export function isFinal(status: VisitStatus): boolean {
  return status === "done" || status === "cancelled" || status === "no_access";
}

export function canTransition(status: VisitStatus, event: VisitEvent): boolean {
  return TRANSITIONS[event][status] !== undefined;
}

/**
 * The status after `event`. Approving a visit whose parts have not arrived makes it
 * tentative, so flow F2 books it when they do.
 */
export function nextStatus(
  status: VisitStatus,
  event: VisitEvent,
  context: { partsMissing?: boolean } = {},
): VisitStatus {
  const next = TRANSITIONS[event][status];
  if (next === undefined) throw new InvalidTransitionError(status, event);
  if (event === "approve" && context.partsMissing) return "tentative";
  return next;
}

/** The status of a new booking: waiting for approval, waiting for parts, or booked. */
export function initialStatus(options: {
  needsApproval: boolean;
  partsMissing: boolean;
}): VisitStatus {
  if (options.needsApproval) return "pending_approval";
  if (options.partsMissing) return "tentative";
  return "booked";
}

export function actorMay(actor: ActorType, event: VisitEvent): boolean {
  return actor === "staff" || ALLOWED[actor].includes(event);
}

/**
 * Customers may cancel or reschedule for free until `cutoffHours` before the start (W6).
 * After that they have to call.
 */
export function customerMayChange(visitStart: Date, now: Date, cutoffHours: number): boolean {
  return visitStart.getTime() - now.getTime() >= cutoffHours * 3_600_000;
}
