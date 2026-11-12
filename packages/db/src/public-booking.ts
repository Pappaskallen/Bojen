/**
 * The public booking page (byggplan step 2.5, spec 4.2 W1–W7): what a customer may see
 * and do without staff sign-in. The firm comes from the link (`tenant.slug`). An existing
 * customer proves who they are with an sms code; a new customer fills in a form.
 *
 * Nothing here returns other customers' data, codes or addresses.
 */
import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  type GeoPoint,
  type Geocoder,
  type MapsProvider,
  type ObjectStorage,
  type PlacePair,
  type PlacementMode,
  type SmsSender,
  type Suggestion,
  addDays,
  bookingSettings,
  isSwedishMobile,
  modeTimeline,
  stockholmInstant,
  suggestSlots,
  toE164,
  travelPairsFor,
  travelSeconds,
} from "@bojen/core";
import {
  CODES_PER_HOUR,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MINUTES,
  checkCode,
  hashCode,
  newCode,
} from "@bojen/core/crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { approvalNeeded } from "./approval";
import { sendCodeSms } from "./messaging";
import { BookingError, bookInTransaction, idempotent, type VisitView } from "./booking";
import type { Database } from "./client";
import {
  attachment,
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  engine,
  engineHoursReading,
  location,
  scheduleBlock,
  serviceType,
  tenant,
  verificationCode,
  workSchedule,
} from "./schema";
import { timeRange } from "./schema/_types";
import { travelTimes } from "./travel";

type Db = Pick<Database, "select" | "insert" | "update" | "execute" | "transaction">;

export interface Firm {
  tenantId: string;
  name: string;
  slug: string;
  /** Brand colour as `#rrggbb`, from `tenant.settings.branding.color` (W1). */
  color: string | null;
  logoUrl: string | null;
  /** Shown as the saving on marina days. */
  calloutPriceOre: number | null;
}

export async function findFirm(db: Db, slug: string): Promise<Firm | null> {
  const [row] = await db
    .select({ id: tenant.id, name: tenant.name, slug: tenant.slug, settings: tenant.settings })
    .from(tenant)
    .where(and(eq(tenant.slug, slug), isNull(tenant.deletedAt)));
  if (!row?.slug) return null;
  const branding = (row.settings as { branding?: { color?: unknown; logoUrl?: unknown } }).branding;
  const color =
    typeof branding?.color === "string" && /^#[0-9a-f]{6}$/i.test(branding.color)
      ? branding.color
      : null;
  const logoUrl =
    typeof branding?.logoUrl === "string" && branding.logoUrl.startsWith("https://")
      ? branding.logoUrl
      : null;
  return {
    tenantId: row.id,
    name: row.name,
    slug: row.slug,
    color,
    logoUrl,
    calloutPriceOre: bookingSettings(row.settings).calloutPriceOre,
  };
}

export interface PublicService {
  id: string;
  name: string;
  durationMinutes: number;
  requiredMode: PlacementMode | null;
  priceOre: number | null;
}

export interface PublicPlace {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  position: GeoPoint;
}

/** Services and the firm's marinas, yards and clubs. Private places are never listed. */
export async function publicCatalog(db: Db, tenantId: string) {
  const services: PublicService[] = await db
    .select({
      id: serviceType.id,
      name: serviceType.name,
      durationMinutes: serviceType.defaultDurationMinutes,
      requiredMode: serviceType.requiredMode,
      priceOre: serviceType.priceOre,
    })
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, tenantId), isNull(serviceType.deletedAt)))
    .orderBy(serviceType.name);
  const rows = await db
    .select({
      id: location.id,
      name: location.name,
      slug: location.slug,
      type: location.type,
      position: location.position,
    })
    .from(location)
    .where(
      and(
        eq(location.tenantId, tenantId),
        isNull(location.deletedAt),
        inArray(location.type, ["marina", "club", "yard"]),
      ),
    )
    .orderBy(location.name);
  const places: PublicPlace[] = rows.flatMap((r) =>
    r.position ? [{ ...r, position: r.position }] : [],
  );
  return { services, places };
}

// --- One-time codes -------------------------------------------------------------------

export interface CodeDeps {
  db: Db;
  sms: SmsSender;
  now: () => Date;
  /** Injected in tests; `crypto.randomInt` otherwise. */
  randomInt?: (max: number) => number;
}

/**
 * Sends a code if the number belongs to a customer of the firm. Answers the same either way,
 * so the page cannot be used to find out who is a customer. At most 3 codes per hour.
 */
export async function requestCode(deps: CodeDeps, firm: Firm, phoneInput: string): Promise<void> {
  const phone = toE164(phoneInput);
  if (!phone || !isSwedishMobile(phone)) throw new BookingError("invalid_input", "phone");
  const now = deps.now();

  const [known] = await deps.db
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.tenantId, firm.tenantId),
        eq(customer.phone, phone),
        isNull(customer.deletedAt),
      ),
    );
  if (!known) return;

  const [recent] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(verificationCode)
    .where(
      and(
        eq(verificationCode.tenantId, firm.tenantId),
        eq(verificationCode.phone, phone),
        gte(verificationCode.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  if ((recent?.n ?? 0) >= CODES_PER_HOUR) return;

  const id = randomUUID();
  const code = newCode(deps.randomInt ?? ((max) => randomInt(max)));
  await deps.db.insert(verificationCode).values({
    id,
    tenantId: firm.tenantId,
    phone,
    codeHash: hashCode(code, id),
    // The injected clock, so the hourly limit and expiry use the same time.
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
  });
  await sendCodeSms(
    { db: deps.db, now: deps.now, sms: deps.sms },
    { tenantId: firm.tenantId, to: phone, customerId: known.id },
    "booking_code",
    { code, firm: firm.name },
  );
}

export type VerifyResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: "wrong" | "expired" | "too_many_attempts" | "used" | "no_code" };

/** Checks the newest code for the number. A right code is used up; a wrong one counts. */
export async function verifyCode(
  deps: Pick<CodeDeps, "db" | "now">,
  tenantId: string,
  phoneInput: string,
  code: string,
): Promise<VerifyResult> {
  const phone = toE164(phoneInput);
  if (!phone) return { ok: false, reason: "no_code" };
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(verificationCode)
      .where(and(eq(verificationCode.tenantId, tenantId), eq(verificationCode.phone, phone)))
      .orderBy(desc(verificationCode.createdAt))
      .limit(1)
      .for("update");
    if (!stored) return { ok: false, reason: "no_code" } as const;

    const result = checkCode(stored, code, now);
    if (result !== "ok") {
      if (result === "wrong") {
        await tx
          .update(verificationCode)
          .set({ attempts: Math.min(stored.attempts + 1, CODE_MAX_ATTEMPTS) })
          .where(eq(verificationCode.id, stored.id));
      }
      return { ok: false, reason: result } as const;
    }
    await tx
      .update(verificationCode)
      .set({ consumedAt: now })
      .where(eq(verificationCode.id, stored.id));
    const [owner] = await tx
      .select({ id: customer.id })
      .from(customer)
      .where(
        and(eq(customer.tenantId, tenantId), eq(customer.phone, phone), isNull(customer.deletedAt)),
      );
    if (!owner) return { ok: false, reason: "no_code" } as const;
    return { ok: true, customerId: owner.id } as const;
  });
}

export interface CustomerBoat {
  id: string;
  label: string;
  /** Where the boat is today, when known. */
  locationId: string | null;
  mode: PlacementMode | null;
}

/** The signed-in customer's boats, for the boat step. */
export async function customerBoats(
  db: Db,
  tenantId: string,
  customerId: string,
  today: string,
): Promise<CustomerBoat[]> {
  const rows = await db
    .select({
      id: boat.id,
      name: boat.name,
      make: boat.make,
      model: boat.model,
      locationId: boatPlacement.locationId,
      mode: boatPlacement.mode,
    })
    .from(boatOwnership)
    .innerJoin(
      boat,
      and(eq(boat.tenantId, boatOwnership.tenantId), eq(boat.id, boatOwnership.boatId)),
    )
    .leftJoin(
      boatPlacement,
      and(
        eq(boatPlacement.tenantId, boat.tenantId),
        eq(boatPlacement.boatId, boat.id),
        isNull(boatPlacement.deletedAt),
        sql`${boatPlacement.validDuring} @> ${today}::date`,
      ),
    )
    .where(
      and(
        eq(boatOwnership.tenantId, tenantId),
        eq(boatOwnership.customerId, customerId),
        isNull(boatOwnership.deletedAt),
        isNull(boat.deletedAt),
        eq(boat.status, "active"),
      ),
    )
    .orderBy(boat.name);
  return rows.map((r) => ({
    id: r.id,
    label:
      [r.name, [r.make, r.model].filter(Boolean).join(" ")].filter(Boolean).join(" – ") || "Båt",
    locationId: r.locationId,
    mode: r.mode,
  }));
}

// --- Suggestions ------------------------------------------------------------------------

export type Place = { locationId: string } | { position: GeoPoint };

export interface SuggestRequest {
  serviceTypeId: string;
  place: Place;
  /** Where the boat is now, and the day that changes (haul-out or launch). */
  mode: PlacementMode;
  changeDate?: string | null;
  /** First day the customer wants (`YYYY-MM-DD`). Defaults to today. */
  earliest?: string | null;
  /** When rescheduling: the visit being moved, whose own time counts as free (step 3.4). */
  excludeVisitId?: string;
}

export interface PublicSuggestion {
  mechanicId: string;
  day: string;
  label: string;
  start: string;
  marinaDay: boolean;
  discount: Suggestion["discount"];
}

export interface SuggestDeps {
  db: Db;
  maps: MapsProvider;
  now: () => Date;
}

const NEW_PLACE = "new-place";
const HORIZON_DAYS = 42;

/** Every visit that holds time in the period, with the place the boat is at that day. */
async function calendar(db: Db, tenantId: string, from: string, to: string, except?: string) {
  const range = timeRange(
    stockholmInstant(from, "00:00"),
    stockholmInstant(addDays(to, 1), "00:00"),
  );
  const visits = (await db.execute(sql`
    select v.mechanic_id as "mechanicId",
           lower(v.time_window) as "start",
           upper(v.time_window) as "end",
           bp.location_id as "locationId"
    from visit v
    join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
    left join boat_placement bp
      on bp.tenant_id = v.tenant_id and bp.boat_id = j.boat_id and bp.deleted_at is null
     and bp.valid_during @> (lower(v.time_window) at time zone 'Europe/Stockholm')::date
    where v.tenant_id = ${tenantId}
      and v.status <> 'cancelled'
      and v.id <> ${except ?? "00000000-0000-0000-0000-000000000000"}
      and v.deleted_at is null
      and v.mechanic_id is not null
      and v.time_window && ${range}::tstzrange
  `)) as unknown as { mechanicId: string; start: string; end: string; locationId: string | null }[];

  const blocks = await db
    .select({
      mechanicId: scheduleBlock.userId,
      start: sql<string>`lower(${scheduleBlock.during})`,
      end: sql<string>`upper(${scheduleBlock.during})`,
    })
    .from(scheduleBlock)
    .where(
      and(
        eq(scheduleBlock.tenantId, tenantId),
        isNull(scheduleBlock.deletedAt),
        sql`${scheduleBlock.during} && ${range}::tstzrange`,
      ),
    );
  const schedule = await db
    .select()
    .from(workSchedule)
    .where(and(eq(workSchedule.tenantId, tenantId), isNull(workSchedule.deletedAt)));

  const asDate = (v: string) => new Date(v);
  return {
    schedule: schedule.map((p) => ({
      mechanicId: p.userId,
      weekday: p.weekday,
      start: p.startTime.slice(0, 5) as `${number}:${number}`,
      end: p.endTime.slice(0, 5) as `${number}:${number}`,
      validFrom: p.validFrom,
      validTo: p.validTo,
    })),
    // A visit without a known place still holds time; it just cannot be part of a route.
    blocks: [
      ...blocks.map((b) => ({
        mechanicId: b.mechanicId,
        start: asDate(b.start),
        end: asDate(b.end),
      })),
      ...visits
        .filter((v) => !v.locationId)
        .map((v) => ({ mechanicId: v.mechanicId, start: asDate(v.start), end: asDate(v.end) })),
    ],
    visits: visits.flatMap((v) =>
      v.locationId
        ? [
            {
              mechanicId: v.mechanicId,
              locationId: v.locationId,
              start: asDate(v.start),
              end: asDate(v.end),
            },
          ]
        : [],
    ),
  };
}

/** Travel times for every pair, also to a place that is only a point on the map. */
async function travelLookup(
  deps: SuggestDeps,
  tenantId: string,
  point: GeoPoint | null,
  pairs: PlacePair[],
  departure: Date,
) {
  const seconds = new Map<string, number>();
  const known = pairs.filter((p) => p.fromId !== NEW_PLACE && p.toId !== NEW_PLACE);
  for (const t of await travelTimes(deps, tenantId, known, departure)) {
    seconds.set(`${t.fromId}>${t.toId}`, t.seconds);
  }

  if (point) {
    const others = [...new Set(pairs.flatMap((p) => [p.fromId, p.toId]))].filter(
      (id) => id !== NEW_PLACE,
    );
    if (others.length > 0) {
      const places = await deps.db
        .select({
          id: location.id,
          position: location.position,
          accessMethod: location.accessMethod,
          crossingMinutes: location.crossingMinutes,
        })
        .from(location)
        .where(and(eq(location.tenantId, tenantId), inArray(location.id, others)));
      const usable = places.flatMap((p) => (p.position ? [{ ...p, position: p.position }] : []));
      const self = { id: NEW_PLACE, position: point, accessMethod: "car" as const };
      const out = await deps.maps.driveMatrix(
        [point],
        usable.map((p) => p.position),
        departure,
      );
      const back = await deps.maps.driveMatrix(
        usable.map((p) => p.position),
        [point],
        departure,
      );
      for (const leg of out) {
        const to = usable[leg.destinationIndex];
        if (to) seconds.set(`${NEW_PLACE}>${to.id}`, travelSeconds(self, to, leg.seconds));
      }
      for (const leg of back) {
        const from = usable[leg.originIndex];
        if (from) seconds.set(`${from.id}>${NEW_PLACE}`, travelSeconds(from, self, leg.seconds));
      }
    }
  }
  return (fromId: string, toId: string) => (fromId === toId ? 0 : seconds.get(`${fromId}>${toId}`));
}

/** Up to three times for the booking page, ranked as in spec 4.2. */
export async function publicSuggestions(
  deps: SuggestDeps,
  tenantId: string,
  request: SuggestRequest,
): Promise<PublicSuggestion[]> {
  const now = deps.now();
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(now);
  const [settingsRow] = await deps.db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const settings = bookingSettings(settingsRow?.settings);
  const [service] = await deps.db
    .select()
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.id, request.serviceTypeId)));
  if (!service) throw new BookingError("not_found", "service_type");

  let targetId = NEW_PLACE;
  let point: GeoPoint | null = null;
  if ("locationId" in request.place) {
    const [place] = await deps.db
      .select({ id: location.id })
      .from(location)
      .where(and(eq(location.tenantId, tenantId), eq(location.id, request.place.locationId)));
    if (!place) throw new BookingError("not_found", "location");
    targetId = place.id;
  } else {
    point = request.place.position;
  }

  const earliest = request.earliest && request.earliest > today ? request.earliest : today;
  const cal = await calendar(
    deps.db,
    tenantId,
    earliest,
    addDays(earliest, HORIZON_DAYS),
    request.excludeVisitId,
  );
  const tenantInput = {
    windows: settings.windows,
    bufferMinutes: settings.bufferMinutes,
    maxExtraDriveMinutes: settings.maxExtraDriveMinutes,
    marinaDayDiscount: settings.marinaDayDiscount,
    ...cal,
  };
  const pairs = travelPairsFor({ tenant: tenantInput, location: { id: targetId } });
  const travel = await travelLookup(
    deps,
    tenantId,
    point,
    pairs,
    stockholmInstant(earliest, "08:00"),
  );

  const suggestions = suggestSlots({
    tenant: tenantInput,
    serviceType: {
      durationMinutes: service.defaultDurationMinutes,
      requiredMode: service.requiredMode,
    },
    location: { id: targetId },
    mode: modeTimeline(request.mode, request.changeDate),
    earliest,
    partsLeadDays: 0,
    travel,
    now,
    horizonDays: HORIZON_DAYS,
    limit: 3,
  });
  return suggestions.map((s) => ({
    mechanicId: s.mechanicId,
    day: s.day,
    label: s.label,
    start: s.earliestStart.toISOString(),
    marinaDay: s.marinaDay,
    discount: s.discount,
  }));
}

// --- Submitting -------------------------------------------------------------------------

export interface NewCustomer {
  name: string;
  phone: string;
  email?: string | null;
}

export interface NewBoat {
  name?: string | null;
  make?: string | null;
  model?: string | null;
  engineMake?: string | null;
  engineModel?: string | null;
  engineHours?: number | null;
}

export interface Photo {
  bytes: Uint8Array;
  contentType: string;
}

export interface PublicBookingInput {
  serviceTypeId: string;
  mechanicId: string;
  start: Date;
  /** The signed-in customer (sms code), or a new one. */
  customer: { id: string } | NewCustomer;
  boat: { id: string } | NewBoat;
  place: { locationId: string } | { address: string; position: GeoPoint };
  mode: PlacementMode;
  changeDate?: string | null;
  notes?: string | null;
  photos?: Photo[];
}

export interface PublicBookingDeps {
  db: Db;
  storage: ObjectStorage;
  now: () => Date;
}

export interface PublicBookingResult {
  visit: VisitView;
  replayed: boolean;
  photosSaved: number;
}

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS = 5;

const clean = (value: string | null | undefined, max = 120) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Creates what is missing (customer, boat, place) and books the time in one transaction,
 * under the same idempotency key as staff bookings. Pictures are stored afterwards; a picture
 * that fails does not undo the booking. Whether the booking waits for the mechanic's
 * approval follows the firm's rules (step 2.6, `approvalNeeded`).
 */
export async function submitPublicBooking(
  deps: PublicBookingDeps,
  firm: Pick<Firm, "tenantId">,
  idempotencyKey: string,
  input: PublicBookingInput,
): Promise<PublicBookingResult> {
  const tenantId = firm.tenantId;
  const photos = input.photos ?? [];
  if (photos.length > MAX_PHOTOS) throw new BookingError("invalid_input", "photos");
  for (const p of photos) {
    if (!PHOTO_TYPES.includes(p.contentType as (typeof PHOTO_TYPES)[number])) {
      throw new BookingError("invalid_input", "photo type");
    }
    if (p.bytes.byteLength === 0 || p.bytes.byteLength > MAX_PHOTO_BYTES) {
      throw new BookingError("invalid_input", "photo size");
    }
  }
  if (input.start.getTime() <= deps.now().getTime()) {
    throw new BookingError("invalid_input", "start is in the past");
  }
  let newPhone: string | null = null;
  if (!("id" in input.customer)) {
    newPhone = toE164(input.customer.phone);
    if (!newPhone || !isSwedishMobile(newPhone)) throw new BookingError("invalid_input", "phone");
    if (!clean(input.customer.name)) throw new BookingError("invalid_input", "name");
  }

  const fingerprint = {
    ...input,
    photos: photos.map((p) => createHash("sha256").update(p.bytes).digest("hex")),
  };
  let jobId = "";
  const ctxBase = { tenantId, idempotencyKey, actor: { type: "customer" as const, id: null } };

  const result = await idempotent(deps, ctxBase, "public-create", fingerprint, 201, async (tx) => {
    // Customer
    let customerId: string;
    if ("id" in input.customer) {
      customerId = input.customer.id;
    } else {
      const [existing] = await tx
        .select({ id: customer.id })
        .from(customer)
        .where(and(eq(customer.tenantId, tenantId), eq(customer.phone, newPhone ?? "")));
      if (existing) throw new BookingError("conflict", "already_customer");
      const [created] = await tx
        .insert(customer)
        .values({
          tenantId,
          name: clean(input.customer.name) ?? "",
          phone: newPhone,
          email: clean(input.customer.email, 200),
          acquisitionChannel: "web",
        })
        .returning({ id: customer.id });
      if (!created) throw new Error("customer not created");
      customerId = created.id;
    }

    // Place
    let locationId: string;
    if ("locationId" in input.place) {
      const [place] = await tx
        .select({ id: location.id, type: location.type })
        .from(location)
        .where(and(eq(location.tenantId, tenantId), eq(location.id, input.place.locationId)));
      if (!place) throw new BookingError("not_found", "location");
      locationId = place.id;
    } else {
      const address = clean(input.place.address, 200);
      if (!address) throw new BookingError("invalid_input", "address");
      const [created] = await tx
        .insert(location)
        .values({
          tenantId,
          type: "private_dock",
          name: address,
          address,
          position: input.place.position,
        })
        .returning({ id: location.id });
      if (!created) throw new Error("location not created");
      locationId = created.id;
    }

    // Boat
    let boatId: string;
    if ("id" in input.boat) {
      const [owned] = await tx
        .select({ id: boatOwnership.boatId })
        .from(boatOwnership)
        .where(
          and(
            eq(boatOwnership.tenantId, tenantId),
            eq(boatOwnership.customerId, customerId),
            eq(boatOwnership.boatId, input.boat.id),
            isNull(boatOwnership.deletedAt),
          ),
        );
      if (!owned) throw new BookingError("not_found", "boat");
      boatId = owned.id;
    } else {
      const b = input.boat;
      const [created] = await tx
        .insert(boat)
        .values({ tenantId, name: clean(b.name), make: clean(b.make), model: clean(b.model) })
        .returning({ id: boat.id });
      if (!created) throw new Error("boat not created");
      boatId = created.id;
      await tx.insert(boatOwnership).values({ tenantId, boatId, customerId });
      if (clean(b.engineMake) || clean(b.engineModel)) {
        const [e] = await tx
          .insert(engine)
          .values({ tenantId, boatId, make: clean(b.engineMake), model: clean(b.engineModel) })
          .returning({ id: engine.id });
        if (
          e &&
          typeof b.engineHours === "number" &&
          b.engineHours >= 0 &&
          b.engineHours < 100_000
        ) {
          await tx.insert(engineHoursReading).values({
            tenantId,
            engineId: e.id,
            hours: String(b.engineHours),
            readAt: deps.now(),
            source: "customer",
          });
        }
      }
      // Where the new boat is: in the water until the change, or on land until launch.
      const summer = input.mode === "water";
      await tx.insert(boatPlacement).values({
        tenantId,
        boatId,
        locationId,
        season: summer ? "summer" : "winter",
        mode: input.mode,
        ...(summer
          ? { haulOutDate: input.changeDate ?? null }
          : { launchDate: input.changeDate ?? null }),
      });
    }

    const visitView = await bookInTransaction(
      tx,
      { tenantId, actor: { type: "customer", id: customerId } },
      {
        customerId,
        boatId,
        serviceTypeId: input.serviceTypeId,
        mechanicId: input.mechanicId,
        start: input.start,
        channel: "web",
        needsApproval: await approvalNeeded(tx, tenantId, {
          serviceTypeId: input.serviceTypeId,
          customerId,
        }),
        partsMissing: false,
        description: clean(input.notes, 2000),
      },
      deps.now(),
    );
    jobId = visitView.jobId;
    return visitView;
  });

  let photosSaved = 0;
  if (!result.replayed && photos.length > 0) {
    for (const [i, p] of photos.entries()) {
      const ext = p.contentType.split("/")[1] ?? "bin";
      const key = `${tenantId}/jobs/${jobId}/${randomUUID()}.${ext}`;
      try {
        await deps.storage.put(key, p.bytes, p.contentType);
        await deps.db.insert(attachment).values({
          tenantId,
          ownerType: "job",
          ownerId: jobId,
          storageKey: key,
          contentType: p.contentType,
          sizeBytes: p.bytes.byteLength,
        });
        photosSaved += 1;
      } catch (error) {
        // The booking stands; the mechanic can ask for the picture again.
        console.warn(`[booking] picture ${String(i + 1)} was not stored`, (error as Error).message);
      }
    }
  }
  return { visit: result.visit, replayed: result.replayed, photosSaved };
}

/** Address search for the place step, biased towards the firm's area. */
export async function searchAddress(geocoder: Geocoder, query: string, near?: GeoPoint) {
  return geocoder.search(query, { ...(near ? { near } : {}), limit: 5 });
}
