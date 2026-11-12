/**
 * HTTP handlers for bookings (byggplan step 2.4). The route files in app/api/bookings only
 * wire these up; tests call them with their own dependencies.
 *
 *   POST /api/bookings                 create   → 201, or the stored answer on a repeat
 *   POST /api/bookings/{id}/{action}   change   → 200
 *
 * Every POST needs an `Idempotency-Key` header. Errors are `{ error, detail? }` with
 * 400, 401, 403, 404, 409 (taken, wrong status, too late) or 422 (key reused with other input).
 */
import type { VisitEvent } from "@bojen/core";
import {
  BookingError,
  approvalNeeded,
  changeBooking,
  createBooking,
  type Actor,
  type BookingErrorCode,
  type Database,
} from "@bojen/db";

export interface RequestContext {
  tenantId: string;
  actor: Actor;
}

export interface BookingRouteDeps {
  db: () => Database;
  now: () => Date;
  /** Who is calling, or null when the request is not signed in. */
  authorize: (request: Request) => Promise<RequestContext | null>;
}

const STATUS: Record<BookingErrorCode, number> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_transition: 409,
  too_late: 409,
  idempotency_mismatch: 422,
  link_expired: 410,
  link_used: 410,
};

/** URL action → state machine event. System events (parts arrived, no reply) are not exposed. */
export const ACTIONS: Readonly<Record<string, VisitEvent>> = {
  approve: "approve",
  reject: "reject",
  confirm: "confirm",
  reschedule: "reschedule",
  cancel: "cancel",
  start: "start",
  complete: "complete",
  "no-access": "report_no_access",
};

const CHANNELS = ["phone", "web", "campaign", "marina"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

class BadRequest extends Error {}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequest(field);
  return value;
}

function instant(value: unknown, field: string): Date {
  const date = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new BadRequest(field);
  return date;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => undefined);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BadRequest("body");
  }
  return parsed as Record<string, unknown>;
}

async function handle(
  deps: BookingRouteDeps,
  request: Request,
  work: (ctx: RequestContext & { idempotencyKey: string }) => Promise<Response>,
): Promise<Response> {
  const caller = await deps.authorize(request);
  if (!caller) return json({ error: "unauthorized" }, 401);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return json({ error: "invalid_input", detail: "Idempotency-Key" }, 400);
  try {
    return await work({ ...caller, idempotencyKey });
  } catch (error) {
    if (error instanceof BadRequest)
      return json({ error: "invalid_input", detail: error.message }, 400);
    if (error instanceof BookingError) {
      return json(
        { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
        STATUS[error.code],
      );
    }
    throw error;
  }
}

export function createBookingRoutes(deps: BookingRouteDeps) {
  const bookingDeps = () => ({ db: deps.db(), now: deps.now });

  async function create(request: Request): Promise<Response> {
    return handle(deps, request, async (ctx) => {
      const b = await body(request);
      const isStaff = ctx.actor.type === "staff";
      const channel = isStaff ? b.channel : "web";
      if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) throw new BadRequest("channel");
      if (b.plannedMinutes !== undefined && !Number.isInteger(b.plannedMinutes)) {
        throw new BadRequest("plannedMinutes");
      }
      const customerId = uuid(b.customerId, "customerId");
      const serviceTypeId = uuid(b.serviceTypeId, "serviceTypeId");
      // Staff decide themselves; a customer's booking follows the firm's rules (step 2.6).
      const needsApproval = isStaff
        ? b.needsApproval === true
        : await approvalNeeded(deps.db(), ctx.tenantId, { serviceTypeId, customerId });
      const result = await createBooking(bookingDeps(), ctx, {
        customerId,
        boatId: b.boatId === undefined || b.boatId === null ? null : uuid(b.boatId, "boatId"),
        serviceTypeId,
        mechanicId: uuid(b.mechanicId, "mechanicId"),
        start: instant(b.start, "start"),
        ...(typeof b.plannedMinutes === "number" ? { plannedMinutes: b.plannedMinutes } : {}),
        channel: channel as (typeof CHANNELS)[number],
        needsApproval,
        partsMissing: isStaff ? b.partsMissing === true : false,
      });
      return json(
        { visit: result.visit },
        201,
        result.replayed ? { "Idempotent-Replayed": "true" } : {},
      );
    });
  }

  async function change(request: Request, visitId: string, action: string): Promise<Response> {
    return handle(deps, request, async (ctx) => {
      const event = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
      if (!event) return json({ error: "not_found", detail: "action" }, 404);
      const id = uuid(visitId, "id");
      const b = event === "reschedule" ? await body(request) : {};
      const result = await changeBooking(bookingDeps(), ctx, id, {
        event,
        ...(event === "reschedule" ? { start: instant(b.start, "start") } : {}),
        ...(event === "reschedule" && b.mechanicId !== undefined
          ? { mechanicId: uuid(b.mechanicId, "mechanicId") }
          : {}),
        ...(event === "approve" && b.partsMissing === true ? { partsMissing: true } : {}),
      });
      return json(
        { visit: result.visit },
        200,
        result.replayed ? { "Idempotent-Replayed": "true" } : {},
      );
    });
  }

  return { create, change };
}
