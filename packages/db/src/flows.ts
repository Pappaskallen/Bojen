/**
 * What the flows F1, F5, F7 and F9 read and write (byggplan step 3.3). The worker decides
 * when; this file only fetches a visit with everything its messages need, and keeps the
 * survey rows.
 */
import { stockholmDate } from "@bojen/core";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  appUser,
  boat,
  boatPlacement,
  customer,
  domainEvent,
  engine,
  job,
  location,
  message,
  serviceType,
  survey,
  task,
  tenant,
  visit,
} from "./schema";

type Db = Pick<Database, "select" | "insert" | "update">;

export interface VisitContext {
  tenantId: string;
  visitId: string;
  jobId: string;
  status: string;
  start: Date;
  end: Date;
  firm: {
    name: string;
    phone: string | null;
    slug: string | null;
    settings: Record<string, unknown>;
  };
  customer: { id: string; name: string; phone: string | null; email: string | null };
  boat: { id: string; name: string | null; make: string | null; model: string | null } | null;
  engine: { make: string | null; model: string | null } | null;
  service: { name: string; preparationText: string | null; priceOre: number | null } | null;
  mechanic: { name: string } | null;
  place: { name: string; address: string | null; spotId: string | null; mode: string } | null;
}

/** A visit and everything its messages need, or null when it does not exist. */
export async function visitContext(
  db: Db,
  tenantId: string,
  visitId: string,
): Promise<VisitContext | null> {
  const [row] = await db
    .select({
      visitId: visit.id,
      jobId: job.id,
      status: visit.status,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      end: sql<Date>`upper(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      firmName: tenant.name,
      firmPhone: tenant.phone,
      firmSlug: tenant.slug,
      firmSettings: tenant.settings,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      boatId: boat.id,
      boatName: boat.name,
      boatMake: boat.make,
      boatModel: boat.model,
      serviceName: serviceType.name,
      preparationText: serviceType.preparationText,
      priceOre: serviceType.priceOre,
      mechanicName: appUser.name,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .innerJoin(tenant, eq(tenant.id, visit.tenantId))
    .innerJoin(customer, and(eq(customer.tenantId, job.tenantId), eq(customer.id, job.customerId)))
    .leftJoin(boat, and(eq(boat.tenantId, job.tenantId), eq(boat.id, job.boatId)))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .leftJoin(appUser, and(eq(appUser.tenantId, visit.tenantId), eq(appUser.id, visit.mechanicId)))
    .where(and(eq(visit.tenantId, tenantId), eq(visit.id, visitId)));
  if (!row) return null;

  let engineRow: VisitContext["engine"] = null;
  let place: VisitContext["place"] = null;
  if (row.boatId) {
    const [e] = await db
      .select({ make: engine.make, model: engine.model })
      .from(engine)
      .where(
        and(eq(engine.tenantId, tenantId), eq(engine.boatId, row.boatId), isNull(engine.deletedAt)),
      )
      .limit(1);
    engineRow = e ?? null;
    const [p] = await db
      .select({
        name: location.name,
        address: location.address,
        spotId: boatPlacement.spotId,
        mode: boatPlacement.mode,
      })
      .from(boatPlacement)
      .innerJoin(
        location,
        and(
          eq(location.tenantId, boatPlacement.tenantId),
          eq(location.id, boatPlacement.locationId),
        ),
      )
      .where(
        and(
          eq(boatPlacement.tenantId, tenantId),
          eq(boatPlacement.boatId, row.boatId),
          sql`${boatPlacement.validDuring} @> ${stockholmDate(row.start)}::date`,
          isNull(boatPlacement.deletedAt),
        ),
      )
      .limit(1);
    place = p ?? null;
  }

  return {
    tenantId,
    visitId: row.visitId,
    jobId: row.jobId,
    status: row.status,
    start: row.start,
    end: row.end,
    firm: {
      name: row.firmName,
      phone: row.firmPhone,
      slug: row.firmSlug,
      settings: row.firmSettings,
    },
    customer: {
      id: row.customerId,
      name: row.customerName,
      phone: row.customerPhone,
      email: row.customerEmail,
    },
    boat: row.boatId
      ? { id: row.boatId, name: row.boatName, make: row.boatMake, model: row.boatModel }
      : null,
    engine: engineRow,
    service: row.serviceName
      ? { name: row.serviceName, preparationText: row.preparationText, priceOre: row.priceOre }
      : null,
    mechanic: row.mechanicName ? { name: row.mechanicName } : null,
    place,
  };
}

/** Whether a message from `template` has already gone (or is queued) for the visit. */
export async function alreadySent(
  db: Db,
  tenantId: string,
  visitId: string,
  template: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.tenantId, tenantId),
        eq(message.visitId, visitId),
        eq(message.template, template),
        eq(message.direction, "outbound"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Whether the customer is owed one more confirmation (F1): one for the booking and one for
 * each time they rescheduled it themselves (step 3.4). Counting, rather than a flag, keeps a
 * retried job from sending twice.
 */
export async function confirmationOwed(
  db: Db,
  tenantId: string,
  visitId: string,
  channel: "sms" | "email",
): Promise<boolean> {
  const [sent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(message)
    .where(
      and(
        eq(message.tenantId, tenantId),
        eq(message.visitId, visitId),
        eq(message.template, "f1_confirmation"),
        eq(message.direction, "outbound"),
        eq(message.channel, channel),
      ),
    );
  const [changes] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(domainEvent)
    .where(
      and(
        eq(domainEvent.tenantId, tenantId),
        eq(domainEvent.aggregateType, "visit"),
        eq(domainEvent.aggregateId, visitId),
        eq(domainEvent.type, "visit.reschedule"),
        eq(domainEvent.actorType, "customer"),
      ),
    );
  return (sent?.n ?? 0) < (changes?.n ?? 0) + 1;
}

export interface DomainEventRow {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  /** `customer`, `staff` or `system`. */
  actorType: string;
  occurredAt: Date;
}

export async function loadDomainEvent(db: Db, eventId: string): Promise<DomainEventRow | null> {
  const [row] = await db
    .select({
      id: domainEvent.id,
      tenantId: domainEvent.tenantId,
      aggregateType: domainEvent.aggregateType,
      aggregateId: domainEvent.aggregateId,
      type: domainEvent.type,
      payload: domainEvent.payload,
      actorType: domainEvent.actorType,
      occurredAt: domainEvent.occurredAt,
    })
    .from(domainEvent)
    .where(eq(domainEvent.id, eventId));
  return row ? { ...row, payload: row.payload as Record<string, unknown> } : null;
}

/** When the customer last got the satisfaction question, over all their visits (F9). */
export async function lastSurveyFor(db: Db, tenantId: string, customerId: string) {
  const [row] = await db
    .select({ sentAt: survey.sentAt })
    .from(survey)
    .innerJoin(visit, and(eq(visit.tenantId, survey.tenantId), eq(visit.id, survey.visitId)))
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(
      and(
        eq(survey.tenantId, tenantId),
        eq(job.customerId, customerId),
        isNull(survey.deletedAt),
        gte(survey.sentAt, new Date(0)),
      ),
    )
    .orderBy(desc(survey.sentAt))
    .limit(1);
  return row?.sentAt ?? null;
}

/** Records that the question went out; false when the visit already has a survey. */
export async function startSurvey(db: Db, tenantId: string, visitId: string, sentAt: Date) {
  const rows = await db
    .insert(survey)
    .values({ tenantId, visitId, sentAt })
    .onConflictDoNothing()
    .returning({ id: survey.id });
  return rows.length > 0;
}

/** Stores the score; false when the visit has no open survey. */
export async function answerSurvey(
  db: Db,
  tenantId: string,
  visitId: string,
  score: number,
  answeredAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(survey)
    .set({ score, answeredAt })
    .where(
      and(
        eq(survey.tenantId, tenantId),
        eq(survey.visitId, visitId),
        isNull(survey.answeredAt),
        isNull(survey.deletedAt),
      ),
    )
    .returning({ id: survey.id });
  return rows.length > 0;
}

/** A task for the firm, for example a call after a low score (F9). */
export async function createTask(db: Db, values: typeof task.$inferInsert): Promise<string | null> {
  const [row] = await db.insert(task).values(values).returning({ id: task.id });
  return row?.id ?? null;
}
