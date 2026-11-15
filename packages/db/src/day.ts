/**
 * The mechanic's day (byggplan step 5.5): the day's visits with what the work needs, the order
 * to drive them in, and what is recorded on site: start and done, running hours, parts and
 * pictures. Only the visit's own mechanic, the owner and an administrator may record anything
 * on a visit.
 */
import { createHash, randomUUID } from "node:crypto";
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
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  attachment,
  boat,
  boatPlacement,
  customer,
  engine,
  engineHoursReading,
  idempotencyKey,
  job,
  jobPart,
  location,
  part,
  serviceReport,
  serviceType,
  tenant,
  visit,
} from "./schema";
import { timeRange } from "./schema/_types";
import { type AccessDeps, decryptAccess } from "./access";
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
  voiceNotes: number;
  /** What the mechanic has written on site. */
  notes: string | null;
  /** The service report's status (`drafting`, `draft`, `approved`), once the visit is done. */
  report: string | null;
  /** There is a picture of the boat (see `visitBoatPicture`). */
  boatPicture: boolean;
}

const OPEN = [
  "tentative",
  "reserved",
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
      notes: visit.notes,
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

  const files = await db
    .select({
      ownerId: attachment.ownerId,
      photos: sql<number>`count(*) filter (where ${attachment.contentType} like 'image/%')::int`,
      voice: sql<number>`count(*) filter (where ${attachment.contentType} like 'audio/%')::int`,
    })
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

  const reports = await db
    .select({ visitId: serviceReport.visitId, status: serviceReport.status })
    .from(serviceReport)
    .where(
      and(
        eq(serviceReport.tenantId, tenantId),
        inArray(serviceReport.visitId, visitIds),
        isNull(serviceReport.deletedAt),
      ),
    );

  const pictures = await boatPictures(
    db,
    tenantId,
    rows.map((r) => ({ boatId: r.boatId, jobId: r.jobId })),
  );

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
      photos: files.find((p) => p.ownerId === r.id)?.photos ?? 0,
      voiceNotes: files.find((p) => p.ownerId === r.id)?.voice ?? 0,
      notes: r.notes,
      report: reports.find((p) => p.visitId === r.id)?.status ?? null,
      boatPicture: pictureFor(pictures, r) !== null,
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
    readonly code:
      | "not_found"
      | "forbidden"
      | "invalid_input"
      | "hours_below_last"
      | "bad_picture"
      | "bad_audio",
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
export async function ownVisit(db: Db, actor: DayActor, visitId: string) {
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

/** The recordings phones make (MediaRecorder) and the files a person may pick instead. */
export const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

/** The base type of a recording: "audio/webm;codecs=opus" is audio/webm. */
export const audioType = (contentType: string) =>
  contentType.split(";")[0]?.trim().toLowerCase() ?? "";

/**
 * A voice note from the visit (step 5.5d), saved like a picture. The worker writes it out as
 * text for the report when the visit is done.
 */
export async function addVoiceNote(
  deps: { db: Db; storage: ObjectStorage },
  actor: DayActor,
  visitId: string,
  audio: { bytes: Uint8Array; contentType: string },
): Promise<string> {
  const type = audioType(audio.contentType);
  const ext = AUDIO_TYPES[type];
  if (!ext || audio.bytes.byteLength === 0 || audio.bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new DayError("bad_audio");
  }
  await ownVisit(deps.db, actor, visitId);
  const key = `${actor.tenantId}/visits/${visitId}/${randomUUID()}.${ext}`;
  await deps.storage.put(key, audio.bytes, type);
  const [row] = await deps.db
    .insert(attachment)
    .values({
      tenantId: actor.tenantId,
      ownerType: "visit",
      ownerId: visitId,
      storageKey: key,
      contentType: type,
      sizeBytes: audio.bytes.byteLength,
    })
    .returning({ id: attachment.id });
  if (!row) throw new Error("attachment not created");
  return row.id;
}

export const MAX_NOTE_LENGTH = 4000;

/** What the mechanic writes on site; the latest text replaces the earlier. */
export async function saveNote(db: Db, actor: DayActor, visitId: string, text: string) {
  const note = text.trim();
  if (note.length > MAX_NOTE_LENGTH) throw new DayError("invalid_input");
  await ownVisit(db, actor, visitId);
  await db
    .update(visit)
    .set({ notes: note || null })
    .where(and(eq(visit.tenantId, actor.tenantId), eq(visit.id, visitId)));
}

/**
 * Runs `work` once per key: a form sent again from the offline queue, after an answer that
 * never arrived, finds its key taken and does nothing (step 5.5b). The key and the work share
 * one transaction, so a failed attempt leaves the key free.
 */
export async function onceOnly(
  db: Pick<Database, "transaction">,
  tenantId: string,
  key: string,
  operation: string,
  work: (tx: Db) => Promise<void>,
): Promise<"done" | "replayed"> {
  if (!key || key.length > 200) throw new DayError("invalid_input");
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(idempotencyKey)
      .values({
        tenantId,
        key: `day:${key}`,
        requestHash: createHash("sha256").update(operation).digest("hex"),
        responseStatus: 200,
        responseBody: {},
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKey.id });
    if (!claimed) return "replayed";
    await work(tx as unknown as Db);
    return "done";
  });
}

export interface PhoneCodes {
  code: string | null;
  keyLocation: string | null;
  gateCode: string | null;
  keyBox: string | null;
  /** When the phone must have deleted them. */
  deleteBy: Date;
}

/**
 * The visit's codes for the phone to keep (step 5.5c). Only through `decryptAccess`: the
 * visit's own mechanic within 12 hours of the start, or the owner, and every download is
 * logged. The phone keeps them encrypted until the job is done, or 12 hours after the start,
 * and never longer than 24 hours.
 */
export async function codesForPhone(
  deps: AccessDeps,
  userId: string,
  visitId: string,
): Promise<PhoneCodes> {
  const shown = await decryptAccess(deps, userId, visitId);
  const [row] = await deps.db
    .select({ start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)) })
    .from(visit)
    .where(eq(visit.id, visitId));
  const now = deps.now().getTime();
  const end = Math.min((row?.start.getTime() ?? now) + 12 * 3_600_000, now + 24 * 3_600_000);
  return {
    code: shown.code?.reveal() ?? null,
    keyLocation: shown.keyLocation?.reveal() ?? null,
    gateCode: shown.gateCode?.reveal() ?? null,
    keyBox: shown.keyBox?.reveal() ?? null,
    deleteBy: new Date(end),
  };
}

/** The day to show: `YYYY-MM-DD` from the address, else today in Stockholm. */
export function dayOf(value: unknown, now: Date): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : stockholmDate(now);
}

/**
 * The picture that shows which boat it is (step 5.5d): the boat's own latest picture, else
 * the latest from the job, such as the one the customer added when booking. Pictures from
 * the visits are left out; they are of the work, not of the boat.
 */
async function boatPictures(
  db: Db,
  tenantId: string,
  visits: readonly { boatId: string | null; jobId: string }[],
): Promise<{ ownerType: string; ownerId: string; key: string; contentType: string }[]> {
  const boatIds = visits.flatMap((v) => (v.boatId ? [v.boatId] : []));
  const jobIds = visits.map((v) => v.jobId);
  if (jobIds.length === 0) return [];
  return db
    .select({
      ownerType: attachment.ownerType,
      ownerId: attachment.ownerId,
      key: attachment.storageKey,
      contentType: attachment.contentType,
    })
    .from(attachment)
    .where(
      and(
        eq(attachment.tenantId, tenantId),
        isNull(attachment.deletedAt),
        sql`${attachment.contentType} like 'image/%'`,
        or(
          boatIds.length > 0
            ? and(eq(attachment.ownerType, "boat"), inArray(attachment.ownerId, boatIds))
            : undefined,
          and(eq(attachment.ownerType, "job"), inArray(attachment.ownerId, jobIds)),
        ),
      ),
    )
    .orderBy(desc(attachment.createdAt));
}

/** The visit's boat picture, chosen as `boatPictures` says. */
function pictureFor(
  pictures: Awaited<ReturnType<typeof boatPictures>>,
  v: { boatId: string | null; jobId: string },
) {
  return (
    pictures.find((p) => p.ownerType === "boat" && p.ownerId === v.boatId) ??
    pictures.find((p) => p.ownerType === "job" && p.ownerId === v.jobId) ??
    null
  );
}

/** Whether the boat of a visit has a picture to show, for the report page. */
export async function hasBoatPicture(
  db: Db,
  tenantId: string,
  v: { boatId: string | null; jobId: string },
): Promise<boolean> {
  return pictureFor(await boatPictures(db, tenantId, [v]), v) !== null;
}

/** The picture of the visit's boat, for the day view, if the person may work on the visit. */
export async function visitBoatPicture(
  deps: { db: Db; storage: ObjectStorage },
  actor: DayActor,
  visitId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const v = await ownVisit(deps.db, actor, visitId);
  const picture = pictureFor(await boatPictures(deps.db, actor.tenantId, [v]), v);
  if (!picture) return null;
  return { bytes: await deps.storage.get(picture.key), contentType: picture.contentType };
}
