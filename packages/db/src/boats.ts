/**
 * The boat card (byggplan step 5.2, spec C1): the boat, its owners, where it is each season,
 * its engines and drives with their running hours, the service history with what the reports
 * said, the pictures and whether access information is stored. Read only, and never the codes
 * themselves: those come from `revealBoatAccess` in access.ts, which logs every view.
 */
import { stockholmDate } from "@bojen/core";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  accessInfo,
  appUser,
  attachment,
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  domainEvent,
  drive,
  engine,
  engineHoursReading,
  job,
  location,
  locationAccessRule,
  serviceType,
  visit,
} from "./schema";

type Db = Pick<Database, "select">;

export interface BoatOwner {
  customerId: string;
  name: string;
  phone: string | null;
  role: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface BoatPlacementRow {
  id: string;
  season: string;
  mode: string;
  place: string;
  locationId: string;
  spotId: string | null;
  launchDate: string | null;
  haulOutDate: string | null;
  /** The boat is here today. */
  current: boolean;
}

export interface HoursReading {
  hours: number;
  readAt: Date;
  source: string;
}

export interface BoatEngine {
  id: string;
  position: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  type: string | null;
  fuel: string | null;
  serialNumber: string | null;
  drive: { type: string | null; serialNumber: string | null } | null;
  /** Oldest first. */
  hours: HoursReading[];
}

/** What the mechanic wrote when the report was approved (F7, step 3.3). */
export interface ReportSummary {
  workDone: string | null;
  hours: string | null;
  recommendations: string | null;
  nextService: string | null;
  approvedAt: Date;
}

export interface ServiceVisit {
  id: string;
  start: Date;
  status: string;
  service: string | null;
  mechanic: string | null;
  report: ReportSummary | null;
}

export interface BoatPicture {
  id: string;
  storageKey: string;
  contentType: string;
  createdAt: Date;
}

export interface BoatCard {
  id: string;
  name: string | null;
  make: string | null;
  model: string | null;
  lengthM: string | null;
  year: number | null;
  hullType: string | null;
  registrationNumber: string | null;
  status: string;
  owners: BoatOwner[];
  placements: BoatPlacementRow[];
  engines: BoatEngine[];
  /** Newest first. */
  history: ServiceVisit[];
  /** From the latest report that had any. */
  recommendations: { text: string; nextService: string | null; from: Date } | null;
  pictures: BoatPicture[];
  /** Which access information is stored, never what it says. */
  access: {
    code: boolean;
    keyLocation: boolean;
    gateCode: boolean;
    keyBox: boolean;
    contactName: string | null;
    contactPhone: string | null;
  };
}

export const CARD_PICTURES = 24;
export const CARD_HISTORY = 50;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** Everything the boat card shows, or null when the boat is not this firm's. */
export async function boatCard(
  db: Db,
  tenantId: string,
  boatId: string,
  now: Date,
): Promise<BoatCard | null> {
  const [b] = await db
    .select()
    .from(boat)
    .where(and(eq(boat.tenantId, tenantId), eq(boat.id, boatId), isNull(boat.deletedAt)));
  if (!b) return null;
  const today = stockholmDate(now);

  const owners = await db
    .select({
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      role: boatOwnership.role,
      validFrom: boatOwnership.validFrom,
      validTo: boatOwnership.validTo,
    })
    .from(boatOwnership)
    .innerJoin(
      customer,
      and(
        eq(customer.tenantId, boatOwnership.tenantId),
        eq(customer.id, boatOwnership.customerId),
        isNull(customer.deletedAt),
      ),
    )
    .where(
      and(
        eq(boatOwnership.tenantId, tenantId),
        eq(boatOwnership.boatId, boatId),
        isNull(boatOwnership.deletedAt),
      ),
    )
    .orderBy(asc(boatOwnership.role), asc(customer.name));

  const placements = await db
    .select({
      id: boatPlacement.id,
      season: boatPlacement.season,
      mode: boatPlacement.mode,
      place: location.name,
      locationId: location.id,
      spotId: boatPlacement.spotId,
      launchDate: boatPlacement.launchDate,
      haulOutDate: boatPlacement.haulOutDate,
      current: sql<boolean>`${boatPlacement.validDuring} @> ${today}::date`,
    })
    .from(boatPlacement)
    .innerJoin(
      location,
      and(eq(location.tenantId, boatPlacement.tenantId), eq(location.id, boatPlacement.locationId)),
    )
    .where(
      and(
        eq(boatPlacement.tenantId, tenantId),
        eq(boatPlacement.boatId, boatId),
        isNull(boatPlacement.deletedAt),
      ),
    )
    .orderBy(asc(boatPlacement.season));

  const engineRows = await db
    .select({
      id: engine.id,
      position: engine.position,
      make: engine.make,
      model: engine.model,
      modelYear: engine.modelYear,
      type: engine.type,
      fuel: engine.fuel,
      serialNumber: engine.serialNumber,
      driveType: drive.type,
      driveSerial: drive.serialNumber,
      hasDrive: sql<boolean>`${drive.id} is not null`,
    })
    .from(engine)
    .leftJoin(
      drive,
      and(
        eq(drive.tenantId, engine.tenantId),
        eq(drive.engineId, engine.id),
        isNull(drive.deletedAt),
      ),
    )
    .where(and(eq(engine.tenantId, tenantId), eq(engine.boatId, boatId), isNull(engine.deletedAt)))
    .orderBy(asc(engine.position), asc(engine.createdAt));

  const readings =
    engineRows.length === 0
      ? []
      : await db
          .select({
            engineId: engineHoursReading.engineId,
            hours: engineHoursReading.hours,
            readAt: engineHoursReading.readAt,
            source: engineHoursReading.source,
          })
          .from(engineHoursReading)
          .where(
            and(
              eq(engineHoursReading.tenantId, tenantId),
              inArray(
                engineHoursReading.engineId,
                engineRows.map((e) => e.id),
              ),
              isNull(engineHoursReading.deletedAt),
            ),
          )
          .orderBy(asc(engineHoursReading.readAt));

  const engines: BoatEngine[] = engineRows.map(({ driveType, driveSerial, hasDrive, ...e }) => ({
    ...e,
    drive: hasDrive ? { type: driveType, serialNumber: driveSerial } : null,
    hours: readings
      .filter((r) => r.engineId === e.id)
      .map((r) => ({ hours: Number(r.hours), readAt: r.readAt, source: r.source })),
  }));

  const visits = await db
    .select({
      id: visit.id,
      jobId: job.id,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      status: visit.status,
      service: serviceType.name,
      mechanic: appUser.name,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .leftJoin(appUser, and(eq(appUser.tenantId, visit.tenantId), eq(appUser.id, visit.mechanicId)))
    .where(
      and(
        eq(visit.tenantId, tenantId),
        eq(job.boatId, boatId),
        isNull(visit.deletedAt),
        isNull(job.deletedAt),
      ),
    )
    .orderBy(desc(sql`lower(${visit.timeWindow})`))
    .limit(CARD_HISTORY);

  // The reports: the latest `report.approved` per visit.
  const visitIds = visits.map((v) => v.id);
  const reportRows =
    visitIds.length === 0
      ? []
      : await db
          .select({
            aggregateId: domainEvent.aggregateId,
            payload: domainEvent.payload,
            occurredAt: domainEvent.occurredAt,
          })
          .from(domainEvent)
          .where(
            and(
              eq(domainEvent.tenantId, tenantId),
              eq(domainEvent.aggregateType, "visit"),
              eq(domainEvent.type, "report.approved"),
              inArray(domainEvent.aggregateId, visitIds),
            ),
          )
          .orderBy(asc(domainEvent.occurredAt));
  const reports = new Map<string, ReportSummary>();
  for (const r of reportRows) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    reports.set(r.aggregateId, {
      workDone: text(p.workDone),
      hours: text(p.hours),
      recommendations: text(p.recommendations),
      nextService: text(p.nextService),
      approvedAt: r.occurredAt,
    });
  }
  const history: ServiceVisit[] = visits.map((v) => ({
    id: v.id,
    start: v.start,
    status: v.status,
    service: v.service,
    mechanic: v.mechanic,
    report: reports.get(v.id) ?? null,
  }));
  const latest = [...reports.values()]
    .filter((r) => r.recommendations)
    .sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime())[0];

  // Pictures of the boat, and of its jobs and visits (the booking page saves them on the job).
  const jobIds = [...new Set(visits.map((v) => v.jobId))];
  const pictures = await db
    .select({
      id: attachment.id,
      storageKey: attachment.storageKey,
      contentType: attachment.contentType,
      createdAt: attachment.createdAt,
    })
    .from(attachment)
    .where(
      and(
        eq(attachment.tenantId, tenantId),
        isNull(attachment.deletedAt),
        sql`${attachment.contentType} like 'image/%'`,
        or(
          and(eq(attachment.ownerType, "boat"), eq(attachment.ownerId, boatId)),
          jobIds.length > 0
            ? and(eq(attachment.ownerType, "job"), inArray(attachment.ownerId, jobIds))
            : sql`false`,
          visitIds.length > 0
            ? and(eq(attachment.ownerType, "visit"), inArray(attachment.ownerId, visitIds))
            : sql`false`,
        ),
      ),
    )
    .orderBy(desc(attachment.createdAt))
    .limit(CARD_PICTURES);

  const [info] = await db
    .select({
      code: sql<boolean>`${accessInfo.codeEncrypted} is not null`,
      keyLocation: sql<boolean>`${accessInfo.keyLocationEncrypted} is not null`,
      contactName: accessInfo.contactName,
      contactPhone: accessInfo.contactPhone,
    })
    .from(accessInfo)
    .where(
      and(
        eq(accessInfo.tenantId, tenantId),
        eq(accessInfo.boatId, boatId),
        isNull(accessInfo.deletedAt),
      ),
    );
  const here = placements.find((p) => p.current);
  const [rule] = here
    ? await db
        .select({
          gateCode: sql<boolean>`${locationAccessRule.gateCodeEncrypted} is not null`,
          keyBox: sql<boolean>`${locationAccessRule.keyBoxEncrypted} is not null`,
        })
        .from(locationAccessRule)
        .where(
          and(
            eq(locationAccessRule.tenantId, tenantId),
            eq(locationAccessRule.locationId, here.locationId),
            isNull(locationAccessRule.deletedAt),
          ),
        )
    : [];

  return {
    id: b.id,
    name: b.name,
    make: b.make,
    model: b.model,
    lengthM: b.lengthM,
    year: b.year,
    hullType: b.hullType,
    registrationNumber: b.registrationNumber,
    status: b.status,
    owners,
    placements,
    engines,
    history,
    recommendations: latest?.recommendations
      ? { text: latest.recommendations, nextService: latest.nextService, from: latest.approvedAt }
      : null,
    pictures,
    access: {
      code: info?.code ?? false,
      keyLocation: info?.keyLocation ?? false,
      gateCode: rule?.gateCode ?? false,
      keyBox: rule?.keyBox ?? false,
      contactName: info?.contactName ?? null,
      contactPhone: info?.contactPhone ?? null,
    },
  };
}
