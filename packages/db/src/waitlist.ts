/**
 * What the waitlist flow F4 reads and writes (byggplan step 4.3). The worker decides when
 * and to whom; this file fetches the freed time and the waiting customers, and keeps the
 * entries' status.
 */
import { stockholmDate, type Candidate, type FreedSlot, type PlacementMode } from "@bojen/core";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  boat,
  boatPlacement,
  customer,
  job,
  location,
  message,
  serviceType,
  visit,
  waitlistEntry,
} from "./schema";

type Db = Pick<Database, "select" | "update" | "execute">;

export interface FreedVisit {
  visitId: string;
  status: string;
  mechanicId: string | null;
  customerId: string;
  boatId: string | null;
  slot: FreedSlot;
  /** Name of the place, for the offer text. */
  placeName: string | null;
}

/** A cancelled visit and the time it freed, or null when there is no such visit. */
export async function freedVisit(
  db: Db,
  tenantId: string,
  visitId: string,
): Promise<FreedVisit | null> {
  const [row] = await db
    .select({
      status: visit.status,
      mechanicId: visit.mechanicId,
      customerId: job.customerId,
      boatId: job.boatId,
      start: sql<string>`lower(${visit.timeWindow})`,
      end: sql<string>`upper(${visit.timeWindow})`,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(and(eq(visit.tenantId, tenantId), eq(visit.id, visitId)));
  if (!row) return null;
  const start = new Date(row.start);
  const day = stockholmDate(start);

  let place: {
    id: string;
    name: string;
    areaId: string | null;
    position: FreedSlot["position"];
  } | null = null;
  if (row.boatId) {
    const [p] = await db
      .select({
        id: location.id,
        name: location.name,
        areaId: location.areaId,
        position: location.position,
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
          sql`${boatPlacement.validDuring} @> ${day}::date`,
          isNull(boatPlacement.deletedAt),
        ),
      )
      .limit(1);
    place = p ?? null;
  }
  return {
    visitId,
    status: row.status,
    mechanicId: row.mechanicId,
    customerId: row.customerId,
    boatId: row.boatId,
    placeName: place?.name ?? null,
    slot: {
      start,
      end: new Date(row.end),
      day,
      locationId: place?.id ?? null,
      areaId: place?.areaId ?? null,
      position: place?.position ?? null,
    },
  };
}

/** Whether the mechanic has been given another visit that overlaps the freed time. */
export async function slotTaken(db: Db, tenantId: string, freed: FreedVisit): Promise<boolean> {
  if (!freed.mechanicId) return true;
  const range = `[${freed.slot.start.toISOString()},${freed.slot.end.toISOString()})`;
  const [row] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from visit
    where tenant_id = ${tenantId}
      and mechanic_id = ${freed.mechanicId}
      and id <> ${freed.visitId}
      and status <> 'cancelled'
      and deleted_at is null
      and time_window && ${range}::tstzrange`);
  return (row?.n ?? 0) > 0;
}

/** A waiting customer with what a booking from the entry needs. */
export interface WaitlistCandidate extends Candidate {
  phone: string;
  boatId: string | null;
  serviceTypeId: string | null;
  /** Name of the boat as the sms say it. */
  boatLabel: string;
  serviceName: string | null;
}

/**
 * Everyone waiting, apart from the customer whose visit was cancelled: the entries with
 * their service, their boat's place on the freed day and how many visits are done for them.
 * Whether a time suits them is `rankCandidates`' business.
 */
export async function waitlistCandidates(
  db: Db,
  tenantId: string,
  slot: FreedSlot,
  exceptCustomerId: string,
): Promise<WaitlistCandidate[]> {
  const rows = await db
    .select({
      entryId: waitlistEntry.id,
      customerId: customer.id,
      phone: customer.phone,
      areaId: waitlistEntry.areaId,
      boatId: waitlistEntry.boatId,
      serviceTypeId: waitlistEntry.serviceTypeId,
      earliestDate: waitlistEntry.earliestDate,
      latestDate: waitlistEntry.latestDate,
      createdAt: waitlistEntry.createdAt,
      serviceMinutes: serviceType.defaultDurationMinutes,
      serviceName: serviceType.name,
      requiredMode: serviceType.requiredMode,
      boatName: boat.name,
      boatMake: boat.make,
      boatModel: boat.model,
      placeId: location.id,
      placePosition: location.position,
      placeMode: boatPlacement.mode,
      doneVisits: sql<number>`(
        select count(*)::int from visit v
        join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
        where v.tenant_id = ${waitlistEntry.tenantId} and j.customer_id = ${waitlistEntry.customerId}
          and v.status = 'done' and v.deleted_at is null)`,
    })
    .from(waitlistEntry)
    .innerJoin(
      customer,
      and(eq(customer.tenantId, waitlistEntry.tenantId), eq(customer.id, waitlistEntry.customerId)),
    )
    .leftJoin(
      serviceType,
      and(
        eq(serviceType.tenantId, waitlistEntry.tenantId),
        eq(serviceType.id, waitlistEntry.serviceTypeId),
      ),
    )
    .leftJoin(
      boat,
      and(eq(boat.tenantId, waitlistEntry.tenantId), eq(boat.id, waitlistEntry.boatId)),
    )
    .leftJoin(
      boatPlacement,
      and(
        eq(boatPlacement.tenantId, waitlistEntry.tenantId),
        eq(boatPlacement.boatId, waitlistEntry.boatId),
        sql`${boatPlacement.validDuring} @> ${slot.day}::date`,
        isNull(boatPlacement.deletedAt),
      ),
    )
    .leftJoin(
      location,
      and(eq(location.tenantId, boatPlacement.tenantId), eq(location.id, boatPlacement.locationId)),
    )
    .where(
      and(
        eq(waitlistEntry.tenantId, tenantId),
        eq(waitlistEntry.status, "waiting"),
        isNull(waitlistEntry.deletedAt),
        isNull(customer.deletedAt),
        ne(waitlistEntry.customerId, exceptCustomerId),
      ),
    )
    .orderBy(asc(waitlistEntry.createdAt), asc(waitlistEntry.id));

  return rows.flatMap((r) => {
    if (!r.phone) return [];
    const mode = r.placeMode as PlacementMode | null;
    const makeModel = [r.boatMake, r.boatModel].filter(Boolean).join(" ");
    return [
      {
        entryId: r.entryId,
        customerId: r.customerId,
        phone: r.phone,
        areaId: r.areaId,
        boatId: r.boatId,
        serviceTypeId: r.serviceTypeId,
        serviceName: r.serviceName,
        serviceMinutes: r.serviceMinutes,
        requiredMode: r.requiredMode,
        earliestDate: r.earliestDate,
        latestDate: r.latestDate,
        createdAt: r.createdAt,
        boat: r.placeId && mode ? { locationId: r.placeId, position: r.placePosition, mode } : null,
        doneVisits: r.doneVisits,
        boatLabel: r.boatName ?? (makeModel || "båten"),
      },
    ];
  });
}

export interface OfferRow {
  messageId: string;
  customerId: string;
  phone: string;
  boatId: string | null;
  sentAt: Date | null;
  /** The customer has replied to this offer. */
  answered: boolean;
}

/** The offers sent for a freed time, one per customer (the first). */
export async function offersFor(db: Db, tenantId: string, visitId: string): Promise<OfferRow[]> {
  const rows = await db
    .select({
      messageId: message.id,
      customerId: message.customerId,
      phone: message.toAddress,
      boatId: message.boatId,
      sentAt: message.sentAt,
      // Written out with the table name: a query on one table renders its columns unqualified,
      // which inside the subquery would mean the reply's own columns.
      answered: sql<boolean>`exists (select 1 from message as reply where reply.tenant_id = message.tenant_id and reply.reply_to_id = message.id)`,
    })
    .from(message)
    .where(
      and(
        eq(message.tenantId, tenantId),
        eq(message.visitId, visitId),
        eq(message.template, "f4_offer"),
        eq(message.direction, "outbound"),
        inArray(message.status, ["queued", "sent", "delivered"]),
      ),
    )
    .orderBy(asc(message.createdAt));
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (!r.customerId || !r.phone || seen.has(r.customerId)) return [];
    seen.add(r.customerId);
    return [{ ...r, customerId: r.customerId, phone: r.phone }];
  });
}

/** Sets the entry's status; false when it was not waiting, so a second booking is refused. */
export async function bookWaitlistEntry(
  db: Db,
  tenantId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await db
    .update(waitlistEntry)
    .set({ status: "booked" })
    .where(
      and(
        eq(waitlistEntry.tenantId, tenantId),
        eq(waitlistEntry.id, entryId),
        eq(waitlistEntry.status, "waiting"),
      ),
    )
    .returning({ id: waitlistEntry.id });
  return rows.length > 0;
}
