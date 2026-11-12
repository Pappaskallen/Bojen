/**
 * Approval of bookings that customers make themselves (byggplan step 2.6, W5).
 */
import { type CustomerKind, needsApproval } from "@bojen/core";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { approvalRule, attachment, boat, customer, job, serviceType, visit } from "./schema";

type Reader = Pick<Database, "select">;

/** An existing customer has had work done before: at least one visit that is done. */
export async function customerKindOf(
  db: Reader,
  tenantId: string,
  customerId: string,
): Promise<CustomerKind> {
  const [row] = await db
    .select({ n: count() })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(
      and(
        eq(visit.tenantId, tenantId),
        eq(job.customerId, customerId),
        eq(visit.status, "done"),
        isNull(visit.deletedAt),
      ),
    );
  return (row?.n ?? 0) > 0 ? "existing" : "new";
}

/** Whether a customer's booking of this service waits for the mechanic, by the firm's rules. */
export async function approvalNeeded(
  db: Reader,
  tenantId: string,
  question: {
    serviceTypeId: string;
    customerId: string;
    urgency?: "planned" | "soon" | "emergency";
  },
): Promise<boolean> {
  const rules = await db
    .select({
      serviceTypeId: approvalRule.serviceTypeId,
      customerKind: approvalRule.customerKind,
      mode: approvalRule.mode,
    })
    .from(approvalRule)
    .where(and(eq(approvalRule.tenantId, tenantId), isNull(approvalRule.deletedAt)));
  return needsApproval({
    rules,
    serviceTypeId: question.serviceTypeId,
    customerKind: await customerKindOf(db, tenantId, question.customerId),
    ...(question.urgency ? { urgency: question.urgency } : {}),
  });
}

export interface BookingRequest {
  visitId: string;
  start: Date;
  end: Date;
  customerName: string;
  service: string | null;
  boat: string | null;
  notes: string | null;
  photos: number;
}

/** Bookings waiting for approval, soonest first, for the requests page. */
export async function pendingRequests(db: Reader, tenantId: string): Promise<BookingRequest[]> {
  const photos = db
    .select({ ownerId: attachment.ownerId, n: count().as("n") })
    .from(attachment)
    .where(and(eq(attachment.tenantId, tenantId), eq(attachment.ownerType, "job")))
    .groupBy(attachment.ownerId)
    .as("photos");
  const rows = await db
    .select({
      visitId: visit.id,
      start: sql<string>`lower(${visit.timeWindow})`,
      end: sql<string>`upper(${visit.timeWindow})`,
      customerName: customer.name,
      service: serviceType.name,
      boatName: boat.name,
      boatMake: boat.make,
      boatModel: boat.model,
      notes: job.description,
      photos: photos.n,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .innerJoin(customer, and(eq(customer.tenantId, job.tenantId), eq(customer.id, job.customerId)))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .leftJoin(boat, and(eq(boat.tenantId, job.tenantId), eq(boat.id, job.boatId)))
    .leftJoin(photos, eq(photos.ownerId, job.id))
    .where(
      and(
        eq(visit.tenantId, tenantId),
        eq(visit.status, "pending_approval"),
        isNull(visit.deletedAt),
      ),
    )
    .orderBy(asc(sql`lower(${visit.timeWindow})`));
  return rows.map((r) => ({
    visitId: r.visitId,
    start: new Date(r.start),
    end: new Date(r.end),
    customerName: r.customerName,
    service: r.service,
    boat:
      [r.boatName, [r.boatMake, r.boatModel].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(" – ") || null,
    notes: r.notes,
    photos: Number(r.photos ?? 0),
  }));
}
