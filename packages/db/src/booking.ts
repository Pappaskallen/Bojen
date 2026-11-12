/**
 * Creating and changing bookings (byggplan step 2.4).
 *
 * Every write runs in one transaction that:
 *  1. claims the `Idempotency-Key`, so a repeated request gets the first answer back,
 *  2. locks the mechanic's row, so two bookings for the same mechanic are written one
 *     after the other and the second sees the first,
 *  3. checks the time against working hours, blocked time and other visits with buffer
 *     (packages/core `checkSlot`), and the change against the state machine,
 *  4. writes the visit and a `domain_event`.
 * The exclusion constraint on `visit` is the last line of defence; it maps to a conflict too.
 */
import { createHash } from "node:crypto";
import {
  type ActorType,
  type VisitEvent,
  type VisitStatus,
  InvalidTransitionError,
  actorMay,
  bookingSettings,
  checkSlot,
  customerMayChange,
  initialStatus,
  nextStatus,
  stockholmDate,
} from "@bojen/core";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  appUser,
  domainEvent,
  idempotencyKey,
  job,
  scheduleBlock,
  serviceType,
  tenant,
  visit,
  workSchedule,
} from "./schema";
import { timeRange } from "./schema/_types";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface BookingDeps {
  db: Pick<Database, "transaction">;
  now: () => Date;
}

export interface Actor {
  type: ActorType;
  /** `customer.id` for customers, `app_user.id` for staff, empty for the system. */
  id: string | null;
}

export interface BookingContext {
  tenantId: string;
  actor: Actor;
  idempotencyKey: string;
}

export type BookingErrorCode =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invalid_transition"
  | "too_late"
  | "idempotency_mismatch"
  | "invalid_input"
  /** The customer's short link has expired or was used up (step 3.4). */
  | "link_expired"
  | "link_used";

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "BookingError";
  }
}

export interface VisitView {
  id: string;
  jobId: string;
  mechanicId: string;
  status: VisitStatus;
  start: string;
  end: string;
  plannedMinutes: number;
}

export interface BookingResult {
  visit: VisitView;
  /** The answer was stored from an earlier request with the same key. */
  replayed: boolean;
}

export interface CreateBookingInput {
  customerId: string;
  boatId?: string | null;
  serviceTypeId: string;
  mechanicId: string;
  start: Date;
  /** Defaults to the service's length. */
  plannedMinutes?: number;
  channel: "phone" | "web" | "campaign" | "marina";
  needsApproval: boolean;
  partsMissing: boolean;
  /** What the customer wrote, kept on the job. */
  description?: string | null;
}

export interface ChangeBookingInput {
  event: VisitEvent;
  /** For `reschedule`: the new start, and optionally another mechanic. */
  start?: Date;
  mechanicId?: string;
  partsMissing?: boolean;
  /** Why, for the event log: for example `availability_check` when the customer answered NEJ. */
  reason?: string;
}

const MINUTE = 60_000;

function hash(operation: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify({ operation, input })).digest("hex");
}

/** Postgres codes that mean the time was taken after all. */
function isConflict(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (code === "23P01") return true; // exclusion_violation
  }
  return false;
}

/**
 * Runs `work` in one transaction that first claims the idempotency key. A repeat with the
 * same key and input gets the stored answer; other input with the same key is refused.
 */
export async function idempotent(
  deps: BookingDeps,
  ctx: BookingContext,
  operation: string,
  input: unknown,
  status: number,
  work: (tx: Tx) => Promise<VisitView>,
): Promise<BookingResult> {
  if (!ctx.idempotencyKey || ctx.idempotencyKey.length > 200) {
    throw new BookingError("invalid_input", "Idempotency-Key");
  }
  const requestHash = hash(operation, input);
  try {
    return await deps.db.transaction(async (tx) => {
      // Waits for a concurrent request with the same key, then sees its row.
      const [claimed] = await tx
        .insert(idempotencyKey)
        .values({
          tenantId: ctx.tenantId,
          key: ctx.idempotencyKey,
          requestHash,
          responseStatus: 0,
          responseBody: {},
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyKey.id });

      if (!claimed) {
        const [stored] = await tx
          .update(idempotencyKey)
          .set({ replays: sql`${idempotencyKey.replays} + 1` })
          .where(
            and(
              eq(idempotencyKey.tenantId, ctx.tenantId),
              eq(idempotencyKey.key, ctx.idempotencyKey),
            ),
          )
          .returning();
        if (!stored || stored.requestHash !== requestHash) {
          throw new BookingError("idempotency_mismatch");
        }
        return { visit: stored.responseBody as VisitView, replayed: true };
      }

      const view = await work(tx);
      await tx
        .update(idempotencyKey)
        .set({ responseStatus: status, responseBody: view })
        .where(eq(idempotencyKey.id, claimed.id));
      return { visit: view, replayed: false };
    });
  } catch (error) {
    if (isConflict(error)) throw new BookingError("conflict", "overlaps_visit");
    throw error;
  }
}

/** Locks the mechanics' rows in a fixed order, so two writers never wait on each other in a ring. */
async function lockMechanics(tx: Tx, tenantId: string, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  const rows = await tx
    .select({ id: appUser.id, role: appUser.role })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), inArray(appUser.id, sorted)))
    .orderBy(asc(appUser.id))
    .for("update");
  if (rows.length !== sorted.length) throw new BookingError("not_found", "mechanic");
}

async function settingsOf(tx: Tx, tenantId: string) {
  const [row] = await tx
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!row) throw new BookingError("not_found", "tenant");
  return bookingSettings(row.settings);
}

/** Checks one time against the calendar as it is now, inside the lock. */
async function assertFree(
  tx: Tx,
  tenantId: string,
  slot: { mechanicId: string; start: Date; minutes: number; bufferMinutes: number },
  ignoreVisitId?: string,
) {
  const end = new Date(slot.start.getTime() + slot.minutes * MINUTE);
  const around = timeRange(
    new Date(slot.start.getTime() - slot.bufferMinutes * MINUTE),
    new Date(end.getTime() + slot.bufferMinutes * MINUTE),
  );
  const schedule = await tx
    .select()
    .from(workSchedule)
    .where(and(eq(workSchedule.tenantId, tenantId), eq(workSchedule.userId, slot.mechanicId)));
  const blocks = await tx
    .select({
      start: sql<Date>`lower(${scheduleBlock.during})`.mapWith((v: string) => new Date(v)),
      end: sql<Date>`upper(${scheduleBlock.during})`.mapWith((v: string) => new Date(v)),
    })
    .from(scheduleBlock)
    .where(
      and(
        eq(scheduleBlock.tenantId, tenantId),
        eq(scheduleBlock.userId, slot.mechanicId),
        sql`${scheduleBlock.during} && ${around}::tstzrange`,
      ),
    );
  const visits = await tx
    .select({
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      end: sql<Date>`upper(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
    })
    .from(visit)
    .where(
      and(
        eq(visit.tenantId, tenantId),
        eq(visit.mechanicId, slot.mechanicId),
        ne(visit.status, "cancelled"),
        sql`${visit.timeWindow} && ${around}::tstzrange`,
        ...(ignoreVisitId ? [ne(visit.id, ignoreVisitId)] : []),
      ),
    );

  const problem = checkSlot({
    mechanicId: slot.mechanicId,
    start: slot.start,
    durationMinutes: slot.minutes,
    bufferMinutes: slot.bufferMinutes,
    schedule: schedule.map((p) => ({
      mechanicId: slot.mechanicId,
      weekday: p.weekday,
      start: p.startTime.slice(0, 5) as `${number}:${number}`,
      end: p.endTime.slice(0, 5) as `${number}:${number}`,
      validFrom: p.validFrom,
      validTo: p.validTo,
    })),
    blocks: blocks.map((b) => ({ mechanicId: slot.mechanicId, ...b })),
    visits: visits.map((v) => ({ mechanicId: slot.mechanicId, ...v })),
  });
  if (problem) throw new BookingError("conflict", problem);
}

async function readVisit(tx: Tx, tenantId: string, visitId: string, lock: boolean) {
  const query = tx
    .select({
      id: visit.id,
      jobId: visit.jobId,
      mechanicId: visit.mechanicId,
      status: visit.status,
      plannedMinutes: visit.plannedMinutes,
      customerId: job.customerId,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      end: sql<Date>`upper(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(and(eq(visit.tenantId, tenantId), eq(visit.id, visitId)));
  const [row] = lock ? await query.for("update", { of: visit }) : await query;
  if (!row) throw new BookingError("not_found", "visit");
  return row;
}

function view(row: {
  id: string;
  jobId: string;
  mechanicId: string | null;
  status: VisitStatus;
  plannedMinutes: number;
  start: Date;
  end: Date;
}): VisitView {
  return {
    id: row.id,
    jobId: row.jobId,
    mechanicId: row.mechanicId ?? "",
    status: row.status,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    plannedMinutes: row.plannedMinutes,
  };
}

async function recordEvent(
  tx: Tx,
  ctx: Pick<BookingContext, "tenantId" | "actor">,
  visitId: string,
  type: string,
  payload: Record<string, unknown>,
  /** The injected clock where the caller has one, so the flows time from it (step 3.3). */
  occurredAt?: Date,
) {
  await tx.insert(domainEvent).values({
    tenantId: ctx.tenantId,
    aggregateType: "visit",
    aggregateId: visitId,
    type,
    payload,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    ...(occurredAt ? { occurredAt } : {}),
  });
}

const pipelineFor = (status: VisitStatus) =>
  status === "pending_approval" ? "inquiry" : status === "tentative" ? "parts_ordered" : "booked";

/** Books a new job and its first visit. */
export async function createBooking(
  deps: BookingDeps,
  ctx: BookingContext,
  input: CreateBookingInput,
): Promise<BookingResult> {
  if (ctx.actor.type === "customer" && ctx.actor.id !== input.customerId) {
    throw new BookingError("forbidden");
  }
  if (input.start.getTime() <= deps.now().getTime()) {
    throw new BookingError("invalid_input", "start is in the past");
  }
  return idempotent(deps, ctx, "create", input, 201, (tx) =>
    bookInTransaction(tx, ctx, input, deps.now()),
  );
}

/**
 * The booking itself, inside a transaction the caller owns (and that has claimed the
 * idempotency key). Used by `createBooking` and by the public booking page, which first
 * creates the customer and boat in the same transaction.
 */
export async function bookInTransaction(
  tx: Tx,
  ctx: Pick<BookingContext, "tenantId" | "actor">,
  input: CreateBookingInput,
  /** The injected clock, so the flows time from when the booking was made (step 4.1). */
  occurredAt?: Date,
): Promise<VisitView> {
  const [service] = await tx
    .select({ minutes: serviceType.defaultDurationMinutes })
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, ctx.tenantId), eq(serviceType.id, input.serviceTypeId)));
  if (!service) throw new BookingError("not_found", "service_type");
  const minutes = input.plannedMinutes ?? service.minutes;
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new BookingError("invalid_input", "plannedMinutes");
  }

  const settings = await settingsOf(tx, ctx.tenantId);
  await lockMechanics(tx, ctx.tenantId, [input.mechanicId]);
  await assertFree(tx, ctx.tenantId, {
    mechanicId: input.mechanicId,
    start: input.start,
    minutes,
    bufferMinutes: settings.bufferMinutes,
  });

  const status = initialStatus(input);
  const [newJob] = await tx
    .insert(job)
    .values({
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      boatId: input.boatId ?? null,
      serviceTypeId: input.serviceTypeId,
      channel: input.channel,
      description: input.description ?? null,
      pipelineStatus: pipelineFor(status),
    })
    .returning({ id: job.id });
  if (!newJob) throw new Error("job not created");
  const end = new Date(input.start.getTime() + minutes * MINUTE);
  const [created] = await tx
    .insert(visit)
    .values({
      tenantId: ctx.tenantId,
      jobId: newJob.id,
      mechanicId: input.mechanicId,
      timeWindow: timeRange(input.start, end),
      plannedMinutes: minutes,
      status,
    })
    .returning({ id: visit.id });
  if (!created) throw new Error("visit not created");

  const result = view({
    id: created.id,
    jobId: newJob.id,
    mechanicId: input.mechanicId,
    status,
    plannedMinutes: minutes,
    start: input.start,
    end,
  });
  await recordEvent(
    tx,
    ctx,
    created.id,
    "visit.created",
    {
      status,
      start: result.start,
      end: result.end,
      mechanicId: input.mechanicId,
      channel: input.channel,
    },
    occurredAt,
  );
  return result;
}

/** Approves, confirms, reschedules, cancels or otherwise moves a visit along. */
export async function changeBooking(
  deps: BookingDeps,
  ctx: BookingContext,
  visitId: string,
  input: ChangeBookingInput,
): Promise<BookingResult> {
  if (!actorMay(ctx.actor.type, input.event)) throw new BookingError("forbidden");
  if (input.event === "reschedule" && !input.start) {
    throw new BookingError("invalid_input", "start");
  }
  return idempotent(deps, ctx, `change:${visitId}`, input, 200, async (tx) => {
    const settings = await settingsOf(tx, ctx.tenantId);
    // Lock the mechanics before the visit, the same order as createBooking.
    const current = await readVisit(tx, ctx.tenantId, visitId, false);
    const mechanicId = input.mechanicId ?? current.mechanicId;
    if (input.event === "reschedule") {
      if (!mechanicId) throw new BookingError("invalid_input", "mechanicId");
      await lockMechanics(
        tx,
        ctx.tenantId,
        [mechanicId, current.mechanicId].filter((id): id is string => id !== null),
      );
    }
    const before = await readVisit(tx, ctx.tenantId, visitId, true);

    if (ctx.actor.type === "customer") {
      if (ctx.actor.id !== before.customerId) throw new BookingError("not_found", "visit");
      if (
        input.event !== "confirm" &&
        !customerMayChange(before.start, deps.now(), settings.customerChangeCutoffHours)
      ) {
        throw new BookingError("too_late");
      }
    }

    let status: VisitStatus;
    try {
      status = nextStatus(before.status, input.event, {
        partsMissing: input.partsMissing ?? false,
      });
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw new BookingError("invalid_transition", `${before.status} → ${input.event}`);
      }
      throw error;
    }

    let start = before.start;
    let end = before.end;
    if (input.event === "reschedule" && input.start && mechanicId) {
      if (input.start.getTime() <= deps.now().getTime()) {
        throw new BookingError("invalid_input", "start is in the past");
      }
      start = input.start;
      end = new Date(start.getTime() + before.plannedMinutes * MINUTE);
      await assertFree(
        tx,
        ctx.tenantId,
        {
          mechanicId,
          start,
          minutes: before.plannedMinutes,
          bufferMinutes: settings.bufferMinutes,
        },
        visitId,
      );
    }

    await tx
      .update(visit)
      .set({
        status,
        mechanicId,
        timeWindow: timeRange(start, end),
        // A new time needs a new availability check (F3).
        ...(input.event === "reschedule" ? { availabilityStatus: "not_sent" as const } : {}),
      })
      .where(and(eq(visit.tenantId, ctx.tenantId), eq(visit.id, visitId)));

    const after = view({ ...before, mechanicId, status, start, end });
    await recordEvent(
      tx,
      ctx,
      visitId,
      `visit.${input.event}`,
      {
        from: before.status,
        to: status,
        ...(input.event === "reschedule"
          ? {
              previousStart: before.start.toISOString(),
              start: after.start,
              end: after.end,
              mechanicId,
            }
          : {}),
        day: stockholmDate(start),
        ...(input.reason ? { reason: input.reason } : {}),
      },
      deps.now(),
    );
    return after;
  });
}
