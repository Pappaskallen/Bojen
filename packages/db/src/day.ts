/**
 * The mechanic's day (byggplan step 5.5): the day's visits with what the work needs, the order
 * to drive them in, and what is recorded on site: start and done, running hours, parts and
 * pictures. Only the visit's own mechanic, the owner and an administrator may record anything
 * on a visit.
 */
import { randomUUID } from "node:crypto";
import {
  bookingSettings,
  promisedWindow,
  stockholmDate,
  stockholmInstant,
  stockholmTime,
  suggestOrder,
  type MapsProvider,
  type ObjectStorage,
  type RouteSuggestion,
} from "@bojen/core";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  attachment,
  boat,
  boatPlacement,
  customer,
  engine,
  engineHoursReading,
  job,
  jobPart,
  location,
  part,
  serviceType,
  tenant,
  visit,
} from "./schema";
import { timeRange } from "./schema/_types";
import { travelTimes } from "./travel";

type Db = Pick<Database, "select" | "insert" | "update" | "execute">;

export interface DayEngine {
  id: string;
  label: string;
  lastHours: number | null;
}

export interface DayPart {
  id: string;
  articleNumber: string;
  description: string;
  quantity: number;
  status: string;
}

export interface DayVisit {
  id: string;
  jobId: string;
  start: Date;
  end: Date;
  status: string;
  /** Index of the firm's booking window the visit starts in. */
  window: number;
  /** The window promised to the customer, "08–12". */
  promised: string;
  service: string | null;
  description: string | null;
  customer: { id: string; name: string; phone: string | null };
  boat: { id: string; label: string } | null;
  place: { id: string; name: string; spotId: string | null; mode: string } | null;
  engines: DayEngine[];
  parts: DayPart[];
  photos: number;
}

const OPEN = [
  "tentative",
  "booked",
  "confirmed",
  "unconfirmed",
  "in_progress",
  "done",
  "no_access",
];

/** The mechanic's visits on `day` (Stockholm date), in booked order, cancelled ones left out. */
export async function dayVisits(
  db: Db,
  tenantId: string,
  mechanicId: string,
  day: string,
): Promise<DayVisit[]> {
  const range = timeRange(stockholmInstant(day, "00:00"), stockholmInstant(day, "23:59"));
  const [firm] = await db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const windows = bookingSettings(firm?.settings).windows;

  const rows = await db
    .select({
      id: visit.id,
      jobId: job.id,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      end: sql<Date>`upper(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      status: visit.status,
      service: serviceType.name,
      description: job.description,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      boatId: boat.id,
      boatName: boat.name,
      boatMake: boat.make,
      boatModel: boat.model,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .innerJoin(customer, and(eq(customer.tenantId, job.tenantId), eq(customer.id, job.customerId)))
    .leftJoin(boat, and(eq(boat.tenantId, job.tenantId), eq(boat.id, job.boatId)))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .where(
      and(
        eq(visit.tenantId, tenantId),
        eq(visit.mechanicId, mechanicId),
        isNull(visit.deletedAt),
        inArray(visit.status, OPEN as (typeof visit.status.enumValues)[number][]),
        sql`${visit.timeWindow} && ${range}::tstzrange`,
      ),
    )
    .orderBy(asc(sql`lower(${visit.timeWindow})`));
  if (rows.length === 0) return [];

  const boatIds = rows.flatMap((r) => (r.boatId ? [r.boatId] : []));
  const jobIds = rows.map((r) => r.jobId);
  const visitIds = rows.map((r) => r.id);

  const places = boatIds.length
    ? await db
        .select({
          boatId: boatPlacement.boatId,
          id: location.id,
          name: location.name,
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
            inArray(boatPlacement.boatId, boatIds),
            isNull(boatPlacement.deletedAt),
            sql`${boatPlacement.validDuring} @> ${day}::date`,
          ),
        )
    : [];

  const engines = boatIds.length
    ? await db
        .select({
          id: engine.id,
          boatId: engine.boatId,
          position: engine.position,
          make: engine.make,
          model: engine.model,
          lastHours: sql<string | null>`(
            select r.hours from engine_hours_reading r
            where r.tenant_id = engine.tenant_id and r.engine_id = engine.id and r.deleted_at is null
            order by r.read_at desc limit 1)`,
        })
        .from(engine)
        .where(
          and(
            eq(engine.tenantId, tenantId),
            inArray(engine.boatId, boatIds),
            isNull(engine.deletedAt),
          ),
        )
        .orderBy(asc(engine.position), asc(engine.createdAt))
    : [];

  const parts = await db
    .select({
      id: jobPart.id,
      jobId: jobPart.jobId,
      articleNumber: part.articleNumber,
      description: part.description,
      quantity: jobPart.quantity,
      status: jobPart.status,
    })
    .from(jobPart)
    .innerJoin(part, and(eq(part.tenantId, jobPart.tenantId), eq(part.id, jobPart.partId)))
    .where(
      and(
        eq(jobPart.tenantId, tenantId),
        inArray(jobPart.jobId, jobIds),
        isNull(jobPart.deletedAt),
      ),
    )
    .orderBy(asc(jobPart.createdAt));

  const photos = await db
    .select({ ownerId: attachment.ownerId, n: sql<number>`count(*)::int` })
    .from(attachment)
    .where(
      and(
        eq(attachment.tenantId, tenantId),
        eq(attachment.ownerType, "visit"),
        inArray(attachment.ownerId, visitIds),
        isNull(attachment.deletedAt),
      ),
    )
    .groupBy(attachment.ownerId);

  return rows.map((r) => {
    const time = stockholmTime(r.start);
    const window = Math.max(
      0,
      windows.findIndex((w) => w.start <= time && time < w.end),
    );
    const makeModel = [r.boatMake, r.boatModel].filter(Boolean).join(" ");
    const place = places.find((p) => p.boatId === r.boatId);
    return {
      id: r.id,
      jobId: r.jobId,
      start: r.start,
      end: r.end,
      status: r.status,
      window,
      promised: promisedWindow(r.start, r.end, windows),
      service: r.service,
      description: r.description,
      customer: { id: r.customerId, name: r.customerName, phone: r.customerPhone },
      boat: r.boatId ? { id: r.boatId, label: r.boatName ?? (makeModel || "–") } : null,
      place: place
        ? { id: place.id, name: place.name, spotId: place.spotId, mode: place.mode }
        : null,
      engines: engines
        .filter((e) => e.boatId === r.boatId)
        .map((e) => ({
          id: e.id,
          label: [e.make, e.model].filter(Boolean).join(" ") || "Motor",
          lastHours: e.lastHours === null ? null : Number(e.lastHours),
        })),
      parts: parts
        .filter((p) => p.jobId === r.jobId)
        .map((p) => ({
          id: p.id,
          articleNumber: p.articleNumber,
          description: p.description,
          quantity: Number(p.quantity),
          status: p.status,
        })),
      photos: photos.find((p) => p.ownerId === r.id)?.n ?? 0,
    };
  });
}

/**
 * The order to drive the day in: travel times between the visits' places (from the cache, or
 * the map service once), then every order tried when there are at most 8 stops.
 */
export async function dayRoute(
  deps: { db: Db; maps: MapsProvider },
  tenantId: string,
  visits: readonly DayVisit[],
  departure: Date,
): Promise<RouteSuggestion> {
  const placeIds = [...new Set(visits.flatMap((v) => (v.place ? [v.place.id] : [])))];
  const pairs = placeIds.flatMap((a) =>
    placeIds.filter((b) => b !== a).map((b) => ({ fromId: a, toId: b })),
  );
  const times = pairs.length > 0 ? await travelTimes(deps, tenantId, pairs, departure) : [];
  const seconds = new Map(times.map((t) => [`${t.fromId}>${t.toId}`, t.seconds]));
  return suggestOrder(
    visits.map((v) => ({
      id: v.id,
      placeId: v.place?.id ?? null,
      window: v.window,
      start: v.start,
    })),
    (from, to) => seconds.get(`${from}>${to}`),
  );
}

export class DayError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid_input" | "hours_below_last" | "bad_picture",
  ) {
    super(code);
    this.name = "DayError";
  }
}

export interface DayActor {
  tenantId: string;
  userId: string;
  role: "owner" | "admin" | "mechanic";
}

/** The visit, if the person may record on it: its own mechanic, the owner or an administrator. */
async function ownVisit(db: Db, actor: DayActor, visitId: string) {
  const [row] = await db
    .select({
      jobId: visit.jobId,
      mechanicId: visit.mechanicId,
      boatId: job.boatId,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(and(eq(visit.tenantId, actor.tenantId), eq(visit.id, visitId), isNull(visit.deletedAt)));
  if (!row) throw new DayError("not_found");
  if (actor.role === "mechanic" && row.mechanicId !== actor.userId) throw new DayError("forbidden");
  return row;
}

/** The visit's day (Stockholm date), after checking that the person may record on it. */
export async function visitDayFor(db: Db, actor: DayActor, visitId: string): Promise<string> {
  return stockholmDate((await ownVisit(db, actor, visitId)).start);
}

export const MAX_HOURS = 100_000;

/**
 * A reading of an engine's running hours, from the mechanic on site. Lower than the last
 * reading is refused: the hour counter does not run backwards (a new engine is a new engine).
 */
export async function recordHours(
  db: Db,
  actor: DayActor,
  visitId: string,
  engineId: string,
  hours: number,
  now: Date,
): Promise<void> {
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS)
    throw new DayError("invalid_input");
  const v = await ownVisit(db, actor, visitId);
  const [e] = await db
    .select({ id: engine.id })
    .from(engine)
    .where(
      and(
        eq(engine.tenantId, actor.tenantId),
        eq(engine.id, engineId),
        eq(engine.boatId, v.boatId ?? "00000000-0000-0000-0000-000000000000"),
        isNull(engine.deletedAt),
      ),
    );
  if (!e) throw new DayError("not_found");
  const [last] = await db
    .select({ hours: engineHoursReading.hours })
    .from(engineHoursReading)
    .where(
      and(
        eq(engineHoursReading.tenantId, actor.tenantId),
        eq(engineHoursReading.engineId, engineId),
        isNull(engineHoursReading.deletedAt),
      ),
    )
    .orderBy(desc(engineHoursReading.readAt))
    .limit(1);
  if (last && hours < Number(last.hours)) throw new DayError("hours_below_last");
  await db.insert(engineHoursReading).values({
    tenantId: actor.tenantId,
    engineId,
    hours: hours.toFixed(1),
    readAt: now,
    source: "mechanic",
  });
}

/**
 * A part used on the job: found by its article number, or added to the firm's parts. From the
 * van it is installed at once; ordered parts come with the order flow.
 */
export async function addPart(
  db: Db,
  actor: DayActor,
  visitId: string,
  input: { articleNumber: string; description?: string; quantity?: number },
): Promise<string> {
  const articleNumber = input.articleNumber.trim();
  const quantity = input.quantity ?? 1;
  if (!articleNumber || articleNumber.length > 60) throw new DayError("invalid_input");
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000)
    throw new DayError("invalid_input");
  const v = await ownVisit(db, actor, visitId);
  let [found] = await db
    .select({ id: part.id })
    .from(part)
    .where(
      and(
        eq(part.tenantId, actor.tenantId),
        eq(part.articleNumber, articleNumber),
        isNull(part.deletedAt),
      ),
    );
  if (!found) {
    const description = input.description?.trim();
    if (!description || description.length > 200) throw new DayError("invalid_input");
    [found] = await db
      .insert(part)
      .values({ tenantId: actor.tenantId, articleNumber, description })
      .returning({ id: part.id });
  }
  if (!found) throw new Error("part not created");
  const [row] = await db
    .insert(jobPart)
    .values({
      tenantId: actor.tenantId,
      jobId: v.jobId,
      partId: found.id,
      quantity: String(quantity),
      status: "installed",
      source: "van",
    })
    .returning({ id: jobPart.id });
  if (!row) throw new Error("job part not created");
  return row.id;
}

const PART_STATUSES = ["needed", "ordered", "delivered", "installed"] as const;

/** Marks a part on the visit's job, for example installed when it is in place. */
export async function setPartStatus(
  db: Db,
  actor: DayActor,
  visitId: string,
  jobPartId: string,
  status: unknown,
): Promise<void> {
  if (!PART_STATUSES.includes(status as (typeof PART_STATUSES)[number])) {
    throw new DayError("invalid_input");
  }
  const v = await ownVisit(db, actor, visitId);
  const changed = await db
    .update(jobPart)
    .set({ status: status as (typeof PART_STATUSES)[number] })
    .where(
      and(
        eq(jobPart.tenantId, actor.tenantId),
        eq(jobPart.id, jobPartId),
        eq(jobPart.jobId, v.jobId),
        isNull(jobPart.deletedAt),
      ),
    )
    .returning({ id: jobPart.id });
  if (changed.length === 0) throw new DayError("not_found");
}

export const PICTURE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
export const MAX_PICTURE_BYTES = 12 * 1024 * 1024;

/** A picture from the visit, saved in the private bucket under the firm. */
export async function addVisitPhoto(
  deps: { db: Db; storage: ObjectStorage },
  actor: DayActor,
  visitId: string,
  photo: { bytes: Uint8Array; contentType: string },
): Promise<string> {
  const ext = PICTURE_TYPES[photo.contentType];
  if (!ext || photo.bytes.byteLength === 0 || photo.bytes.byteLength > MAX_PICTURE_BYTES) {
    throw new DayError("bad_picture");
  }
  await ownVisit(deps.db, actor, visitId);
  const key = `${actor.tenantId}/visits/${visitId}/${randomUUID()}.${ext}`;
  await deps.storage.put(key, photo.bytes, photo.contentType);
  const [row] = await deps.db
    .insert(attachment)
    .values({
      tenantId: actor.tenantId,
      ownerType: "visit",
      ownerId: visitId,
      storageKey: key,
      contentType: photo.contentType,
      sizeBytes: photo.bytes.byteLength,
    })
    .returning({ id: attachment.id });
  if (!row) throw new Error("attachment not created");
  return row.id;
}

/** The day to show: `YYYY-MM-DD` from the address, else today in Stockholm. */
export function dayOf(value: unknown, now: Date): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : stockholmDate(now);
}
