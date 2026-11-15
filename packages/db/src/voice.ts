/**
 * The receptionist's tools (byggplan step 6.1, spec 8.2 and 8.3), one function per tool. Each
 * takes the call it runs in and the model's input, and answers with plain data for the model.
 *
 * What the model gets is built field by field from allow-lists: first names, boats by name,
 * make and model, places by name, visits by day and window. Never an access code, a key
 * location, a gate code or an address, whatever the input says (spec 8.2: "inget verktyg
 * returnerar koder eller adresser").
 *
 * Who the caller is: the call's own number names a customer (`call.customer_id`), or the
 * caller gives another number (`claimed_customer_id`, only the first name until the control
 * question). The control question (`bekrafta_kund`) proves it (`verified_customer_id`) and is
 * needed before moving or cancelling a visit.
 */
import {
  CALL_TOKEN_MINUTES,
  CONTROL_ATTEMPTS,
  answersControl,
  bookingSettings,
  dayMonth,
  firstName,
  isSwedishMobile,
  openOffer,
  promisedWindow,
  receptionistSettings,
  sealOffer,
  stockholmDate,
  toE164,
  type Geocoder,
  type MapsProvider,
  type ObjectStorage,
  type OfferedTime,
  type PlacementMode,
} from "@bojen/core";
import { manageLinkExpiry, shortLinkUrl } from "@bojen/core/links";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { BookingError, changeBooking } from "./booking";
import type { Database } from "./client";
import { createTask } from "./flows";
import { queueSms, type MessagingDeps } from "./messaging";
import { publicSuggestions, submitPublicBooking } from "./public-booking";
import {
  appUser,
  boat,
  call,
  customer,
  job,
  location,
  locationContact,
  serviceType,
  tenant,
  visit,
  waitlistEntry,
} from "./schema";
import { createShortLink } from "./short-links";

type Db = Pick<Database, "select" | "insert" | "update" | "execute" | "transaction">;

export interface VoiceDeps extends MessagingDeps {
  db: Db;
  maps: MapsProvider;
  geocoder: Geocoder;
  storage: ObjectStorage;
  /** `SHORT_LINK_KEY`, for the links the receptionist sends. */
  linkKey: string;
  /** Signs the times offered in a call (`VOICE_TOOLS_SECRET`). */
  secret: string;
  /** The app's public address, for the links in the sms, for example `bojen.se`. */
  appBase: string;
}

/** A refusal the model can act on: it says it to the caller, or takes another way. */
export type ToolRefusal = { fel: string };

export type CallRow = typeof call.$inferSelect;

const MINUTE = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

// --- The call ------------------------------------------------------------------------------

/** The firm that owns a number the receptionist answers. */
async function firmByNumber(db: Db, number: string) {
  const [row] = await db
    .select({ id: tenant.id, name: tenant.name })
    .from(tenant)
    .where(and(sql`${tenant.settings} -> 'sms' ->> 'from' = ${number}`, isNull(tenant.deletedAt)));
  return row ?? null;
}

/**
 * A new call to one of the firm's numbers: the call is logged, and the caller's number looked
 * up (spec 8.3). Null when the number belongs to no firm.
 */
export async function startCall(
  db: Db,
  input: { to: string; from: string | null; externalId?: string | null; now: Date },
): Promise<{ callId: string; tenantId: string; expiresAt: number } | null> {
  const to = toE164(input.to) ?? input.to;
  const firm = await firmByNumber(db, to);
  if (!firm) return null;
  const from = input.from ? toE164(input.from) : null;
  const known = from ? await customerByPhone(db, firm.id, from) : null;
  const [row] = await db
    .insert(call)
    .values({
      tenantId: firm.id,
      callerNumber: from,
      customerId: known?.id ?? null,
      startedAt: input.now,
      // The first line says the call is recorded; stoppa_inspelning turns it off.
      recordingAllowed: true,
      externalId: input.externalId ?? null,
    })
    .returning({ id: call.id });
  if (!row) throw new Error("call not created");
  return {
    callId: row.id,
    tenantId: firm.id,
    expiresAt: input.now.getTime() + CALL_TOKEN_MINUTES * MINUTE,
  };
}

/** The call behind a token, or null when it has ended or does not exist. */
export async function openCall(db: Db, tenantId: string, callId: string): Promise<CallRow | null> {
  const [row] = await db
    .select()
    .from(call)
    .where(and(eq(call.tenantId, tenantId), eq(call.id, callId), isNull(call.deletedAt)));
  return row && !row.endedAt ? row : null;
}

async function customerByPhone(db: Db, tenantId: string, phone: string) {
  const [row] = await db
    .select({ id: customer.id, name: customer.name, phone: customer.phone })
    .from(customer)
    .where(
      and(eq(customer.tenantId, tenantId), eq(customer.phone, phone), isNull(customer.deletedAt)),
    );
  return row ?? null;
}

/** The customer this call may act for: proven, or named by the call's own number. */
const identified = (c: CallRow) => c.verifiedCustomerId ?? c.customerId;

// --- What the model may know ---------------------------------------------------------------

export interface AgentBoat {
  id: string;
  namn: string | null;
  marke: string | null;
  modell: string | null;
  plats: { id: string; namn: string } | null;
  lage: string | null;
}

export interface AgentVisit {
  id: string;
  tjanst: string | null;
  dag: string;
  datum: string;
  fonster: string;
  status: string;
  bat: string | null;
}

/** The customer context for the model (spec 8.3): first name, boats and coming visits only. */
export interface AgentContext {
  kand: boolean;
  kund?: { id: string; fornamn: string };
  batar?: AgentBoat[];
  kommande_besok?: AgentVisit[];
  /** Someone at a marina or yard: a business caller (spec 8.3). */
  marinakontakt?: { fornamn: string; plats: string };
  /** The caller gave another number: who it is waits for the control question. */
  kontroll_kravs?: boolean;
}

/**
 * The customer's active boats, each at the place it is today, or else its latest place, so
 * the agent can ask "Gäller det Nimbusen på Bullandö?" also between seasons. Names only.
 */
async function boatsOf(db: Db, tenantId: string, customerId: string, day: string) {
  const rows = await db.execute<{
    id: string;
    name: string | null;
    make: string | null;
    model: string | null;
    placeId: string | null;
    placeName: string | null;
    mode: string | null;
  }>(sql`
    select b.id, b.name, b.make, b.model, p.location_id as "placeId", p.name as "placeName", p.mode
      from boat_ownership bo
      join boat b on b.tenant_id = bo.tenant_id and b.id = bo.boat_id
      left join lateral (
        select bp.location_id, l.name, bp.mode
          from boat_placement bp
          join location l on l.tenant_id = bp.tenant_id and l.id = bp.location_id
         where bp.tenant_id = b.tenant_id and bp.boat_id = b.id and bp.deleted_at is null
         order by (bp.valid_during @> ${day}::date) desc, upper(bp.valid_during) desc nulls first
         limit 1) p on true
     where bo.tenant_id = ${tenantId} and bo.customer_id = ${customerId}
       and bo.deleted_at is null and b.deleted_at is null and b.status = 'active'
     order by b.created_at`);
  return [...rows];
}

async function visitsOf(
  db: Db,
  tenantId: string,
  customerId: string,
  now: Date,
): Promise<AgentVisit[]> {
  const [firm] = await db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  const windows = bookingSettings(firm?.settings).windows;
  const rows = await db
    .select({
      id: visit.id,
      start: sql<Date>`lower(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      end: sql<Date>`upper(${visit.timeWindow})`.mapWith((v: string) => new Date(v)),
      status: visit.status,
      service: serviceType.name,
      boatName: boat.name,
      boatModel: boat.model,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .leftJoin(
      serviceType,
      and(eq(serviceType.tenantId, job.tenantId), eq(serviceType.id, job.serviceTypeId)),
    )
    .leftJoin(boat, and(eq(boat.tenantId, job.tenantId), eq(boat.id, job.boatId)))
    .where(
      and(
        eq(visit.tenantId, tenantId),
        eq(job.customerId, customerId),
        isNull(visit.deletedAt),
        inArray(visit.status, [
          "pending_approval",
          "tentative",
          "reserved",
          "booked",
          "confirmed",
          "unconfirmed",
        ]),
        sql`upper(${visit.timeWindow}) > ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(sql`lower(${visit.timeWindow})`));
  return rows.map((r) => ({
    id: r.id,
    tjanst: r.service,
    dag: stockholmDate(r.start),
    datum: dayMonth(r.start),
    fonster: promisedWindow(r.start, r.end, windows),
    status: r.status,
    bat: r.boatName ?? r.boatModel,
  }));
}

/** Everything the model may know about a customer the call has identified. */
async function fullContext(
  deps: Pick<VoiceDeps, "db" | "now">,
  tenantId: string,
  customerId: string,
): Promise<AgentContext> {
  const [c] = await deps.db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(and(eq(customer.tenantId, tenantId), eq(customer.id, customerId)));
  if (!c) return { kand: false };
  const now = deps.now();
  const boats = await boatsOf(deps.db, tenantId, customerId, stockholmDate(now));
  return {
    kand: true,
    kund: { id: c.id, fornamn: firstName(c.name) },
    batar: boats.map((b) => ({
      id: b.id,
      namn: b.name,
      marke: b.make,
      modell: b.model,
      plats: b.placeId && b.placeName ? { id: b.placeId, namn: b.placeName } : null,
      lage: b.mode,
    })),
    kommande_besok: await visitsOf(deps.db, tenantId, customerId, now),
  };
}

/** The context before the first line: the caller's own number (spec 8.3 point 2). */
export async function callContext(
  deps: Pick<VoiceDeps, "db" | "now">,
  c: CallRow,
): Promise<AgentContext> {
  const who = identified(c);
  if (who) return fullContext(deps, c.tenantId, who);
  if (c.claimedCustomerId) {
    const [claimed] = await deps.db
      .select({ name: customer.name })
      .from(customer)
      .where(eq(customer.id, c.claimedCustomerId));
    return claimed
      ? {
          kand: true,
          kund: { id: c.claimedCustomerId, fornamn: firstName(claimed.name) },
          kontroll_kravs: true,
        }
      : { kand: false };
  }
  if (c.callerNumber) {
    const [contact] = await deps.db
      .select({ name: locationContact.name, place: location.name })
      .from(locationContact)
      .innerJoin(
        location,
        and(
          eq(location.tenantId, locationContact.tenantId),
          eq(location.id, locationContact.locationId),
        ),
      )
      .where(
        and(
          eq(locationContact.tenantId, c.tenantId),
          eq(locationContact.phone, c.callerNumber),
          isNull(locationContact.deletedAt),
        ),
      )
      .limit(1);
    if (contact)
      return {
        kand: false,
        marinakontakt: { fornamn: firstName(contact.name), plats: contact.place },
      };
  }
  return { kand: false };
}

// --- The tools -----------------------------------------------------------------------------

/** hitta_kund: by the number the caller gives. Another number than the call's needs control. */
export async function hittaKund(
  deps: VoiceDeps,
  c: CallRow,
  input: unknown,
): Promise<AgentContext | ToolRefusal> {
  const phone = toE164(text(record(input).telefon, 40) ?? "");
  if (!phone) return { fel: "ogiltigt_nummer" };
  if (phone === c.callerNumber) return callContext(deps, c);
  const found = await customerByPhone(deps.db, c.tenantId, phone);
  if (!found) return { kand: false };
  if (found.id === identified(c)) return callContext(deps, c);
  await deps.db
    .update(call)
    .set({ claimedCustomerId: found.id })
    .where(and(eq(call.tenantId, c.tenantId), eq(call.id, c.id)));
  return {
    kand: true,
    kund: { id: found.id, fornamn: firstName(found.name) },
    kontroll_kravs: true,
  };
}

/** bekrafta_kund: the caller names the boat, its model or its marina (spec 8.3 point 4). */
export async function bekraftaKund(
  deps: VoiceDeps,
  c: CallRow,
  input: unknown,
): Promise<
  ({ bekraftad: true } & AgentContext) | { bekraftad: false; forsok_kvar: number } | ToolRefusal
> {
  const target = c.claimedCustomerId ?? c.customerId;
  if (!target) return { fel: "ingen_kund" };
  if (c.verifiedCustomerId === target) return { bekraftad: true, ...(await callContext(deps, c)) };
  if (c.controlAttempts >= CONTROL_ATTEMPTS) return { fel: "for_manga_forsok" };
  const answer = text(record(input).svar, 300) ?? "";
  const boats = await boatsOf(deps.db, c.tenantId, target, stockholmDate(deps.now()));
  const places = await deps.db.execute<{ name: string }>(sql`
    select distinct l.name from boat_placement bp
      join boat_ownership bo on bo.tenant_id = bp.tenant_id and bo.boat_id = bp.boat_id
      join location l on l.tenant_id = bp.tenant_id and l.id = bp.location_id
     where bo.tenant_id = ${c.tenantId} and bo.customer_id = ${target}
       and bo.deleted_at is null and bp.deleted_at is null`);
  const ok = answersControl(answer, {
    boats: boats.map((b) => ({ name: b.name, make: b.make, model: b.model })),
    places: [...places].map((p) => p.name),
  });
  if (!ok) {
    const attempts = c.controlAttempts + 1;
    await deps.db
      .update(call)
      .set({ controlAttempts: attempts })
      .where(and(eq(call.tenantId, c.tenantId), eq(call.id, c.id)));
    return { bekraftad: false, forsok_kvar: Math.max(0, CONTROL_ATTEMPTS - attempts) };
  }
  const [updated] = await deps.db
    .update(call)
    .set({ verifiedCustomerId: target })
    .where(and(eq(call.tenantId, c.tenantId), eq(call.id, c.id)))
    .returning();
  return {
    bekraftad: true,
    ...(await callContext(deps, updated ?? { ...c, verifiedCustomerId: target })),
  };
}

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** The place for foresla_tider: a known id, a marina named by the caller, or an address. */
async function placeFor(
  deps: VoiceDeps,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<OfferedTime["place"] | null> {
  const placeId = id(input.plats_id);
  if (placeId) {
    const [p] = await deps.db
      .select({ id: location.id })
      .from(location)
      .where(
        and(eq(location.tenantId, tenantId), eq(location.id, placeId), isNull(location.deletedAt)),
      );
    return p ? { locationId: p.id } : null;
  }
  const named = text(input.plats_namn, 120);
  if (named) {
    const all = await deps.db
      .select({ id: location.id, name: location.name })
      .from(location)
      .where(
        and(
          eq(location.tenantId, tenantId),
          isNull(location.deletedAt),
          inArray(location.type, ["marina", "club", "yard"]),
        ),
      );
    const want = fold(named);
    const hit = all.find(
      (l) => fold(l.name).includes(want) || want.includes(fold(l.name).split(" ")[0] ?? "~"),
    );
    return hit ? { locationId: hit.id } : null;
  }
  const address = text(input.adress, 200);
  if (address) {
    const [found] = await deps.geocoder.search(address, { limit: 1 });
    return found ? { address, lng: found.position.lng, lat: found.position.lat } : null;
  }
  return null;
}

const MODES: readonly PlacementMode[] = ["water", "land", "indoor"];

/** foresla_tider: up to three times, best first, each with an id that only this call can book. */
export async function foreslaTider(deps: VoiceDeps, c: CallRow, input: unknown) {
  const i = record(input);
  const serviceTypeId = id(i.tjanst_id);
  const mode = MODES.find((m) => m === i.lage);
  if (!serviceTypeId || !mode) return { fel: "ogiltig_indata" };
  const place = await placeFor(deps, c.tenantId, i);
  if (!place) return { fel: "okand_plats" };
  const changeDate =
    typeof i.andras_datum === "string" && DATE.test(i.andras_datum) ? i.andras_datum : null;
  const earliest = typeof i.tidigast === "string" && DATE.test(i.tidigast) ? i.tidigast : null;
  try {
    const times = await publicSuggestions(deps, c.tenantId, {
      serviceTypeId,
      place:
        "address" in place
          ? { position: { lng: place.lng, lat: place.lat } }
          : { locationId: place.locationId },
      mode,
      changeDate,
      earliest,
    });
    return {
      tider: times.map((t) => {
        const start = new Date(t.start);
        const offer: OfferedTime = {
          callId: c.id,
          serviceTypeId,
          mechanicId: t.mechanicId,
          start: t.start,
          mode,
          place,
        };
        return {
          tid_id: sealOffer(deps.secret, offer),
          dag: t.day,
          datum: dayMonth(start),
          fonster: t.label,
          marinadag: t.marinaDay,
          rabatt: t.discount,
        };
      }),
      ...(changeDate ? { andras_datum: changeDate } : {}),
    };
  } catch (error) {
    if (error instanceof BookingError && error.code === "not_found") return { fel: "okand_tjanst" };
    throw error;
  }
}

/** skapa_bokning: a time this call was offered, for the caller, idempotent per call and time. */
export async function skapaBokning(deps: VoiceDeps, c: CallRow, input: unknown) {
  const i = record(input);
  const offer = typeof i.tid_id === "string" ? openOffer(deps.secret, i.tid_id, c.id) : null;
  if (!offer) return { fel: "okand_tid" };
  const description = text(i.beskrivning, 2000);
  if (!description) return { fel: "beskrivning_saknas" };
  const who = identified(c);
  let customerInput: { id: string } | { name: string; phone: string };
  if (who) customerInput = { id: who };
  else {
    const name = text(i.namn, 120);
    const phone = c.callerNumber ?? toE164(text(i.telefon, 40) ?? "");
    if (!name) return { fel: "namn_saknas" };
    if (!phone || !isSwedishMobile(phone)) return { fel: "mobilnummer_saknas" };
    // Someone else's number given in the call is not this caller's to book on.
    if (await customerByPhone(deps.db, c.tenantId, phone)) return { fel: "kontroll_kravs" };
    customerInput = { name, phone };
  }
  const boatId = id(i.bat_id);
  const urgency = (["planned", "soon", "emergency"] as const).find((u) => u === i.bradskande);
  const notes = [
    description,
    i.osaker === true ? "(Osäkra uppgifter, behöver kontrolleras.)" : null,
  ]
    .filter(Boolean)
    .join(" ");
  try {
    const result = await submitPublicBooking(
      { db: deps.db, storage: deps.storage, now: deps.now },
      { tenantId: c.tenantId },
      `call:${c.id}:${offer.start}`,
      {
        serviceTypeId: offer.serviceTypeId,
        mechanicId: offer.mechanicId,
        start: new Date(offer.start),
        customer: customerInput,
        boat: boatId
          ? { id: boatId }
          : {
              make: text(i.bat_marke, 80),
              model: text(i.bat_modell, 80),
              engineMake: text(i.motor_marke, 80),
              engineModel: text(i.motor_modell, 80),
            },
        place:
          "locationId" in offer.place
            ? { locationId: offer.place.locationId }
            : {
                address: offer.place.address,
                position: { lng: offer.place.lng, lat: offer.place.lat },
              },
        mode: offer.mode,
        notes,
        channel: "phone",
        ...(urgency ? { urgency } : {}),
      },
    );
    const v = result.visit;
    // The call now knows its customer, and the job it made.
    const [made] = await deps.db
      .select({ customerId: job.customerId })
      .from(job)
      .where(and(eq(job.tenantId, c.tenantId), eq(job.id, v.jobId)));
    await deps.db
      .update(call)
      .set({ jobId: v.jobId, ...(who ? {} : { customerId: made?.customerId ?? null }) })
      .where(and(eq(call.tenantId, c.tenantId), eq(call.id, c.id)));
    return { besok_id: v.id, status: v.status };
  } catch (error) {
    if (error instanceof BookingError) {
      if (error.code === "conflict") return { fel: "tiden_ar_tagen" };
      if (error.code === "not_found") return { fel: "okand_bat_eller_plats" };
      if (error.code === "invalid_input") return { fel: "ogiltig_indata" };
    }
    throw error;
  }
}

/** hamta_bokningar: the identified customer's coming visits. */
export async function hamtaBokningar(deps: VoiceDeps, c: CallRow) {
  const who = identified(c);
  if (!who) return { fel: c.claimedCustomerId ? "kontroll_kravs" : "ingen_kund" };
  return { besok: await visitsOf(deps.db, c.tenantId, who, deps.now()) };
}

/** The visit, if it is the proven customer's: moving and cancelling need the control question. */
async function ownVisitForChange(deps: VoiceDeps, c: CallRow, visitId: string | null) {
  if (!c.verifiedCustomerId) return { fel: "kontroll_kravs" } as const;
  if (!visitId) return { fel: "okant_besok" } as const;
  const [v] = await deps.db
    .select({ id: visit.id })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(
      and(
        eq(visit.tenantId, c.tenantId),
        eq(visit.id, visitId),
        eq(job.customerId, c.verifiedCustomerId),
        isNull(visit.deletedAt),
      ),
    );
  return v
    ? ({ ok: true, customerId: c.verifiedCustomerId } as const)
    : ({ fel: "okant_besok" } as const);
}

const changeRefusal = (error: unknown) => {
  if (error instanceof BookingError) {
    if (error.code === "too_late") return { fel: "for_sent_att_andra" };
    if (error.code === "conflict") return { fel: "tiden_ar_tagen" };
    if (error.code === "invalid_transition") return { fel: "kan_inte_andras" };
    if (error.code === "not_found") return { fel: "okant_besok" };
  }
  throw error;
};

/** omboka_bokning: to a time this call was offered, as the customer, within the firm's limit. */
export async function ombokaBokning(deps: VoiceDeps, c: CallRow, input: unknown) {
  const i = record(input);
  const visitId = id(i.besok_id);
  const own = await ownVisitForChange(deps, c, visitId);
  if ("fel" in own) return own;
  const offer = typeof i.tid_id === "string" ? openOffer(deps.secret, i.tid_id, c.id) : null;
  if (!offer || !visitId) return { fel: "okand_tid" };
  try {
    const r = await changeBooking(
      deps,
      {
        tenantId: c.tenantId,
        actor: { type: "customer", id: own.customerId },
        idempotencyKey: `call:${c.id}:reschedule:${visitId}:${offer.start}`,
      },
      visitId,
      { event: "reschedule", start: new Date(offer.start), mechanicId: offer.mechanicId },
    );
    return { besok_id: r.visit.id, status: r.visit.status };
  } catch (error) {
    return changeRefusal(error);
  }
}

/** avboka_bokning: as the customer, within the firm's limit. */
export async function avbokaBokning(deps: VoiceDeps, c: CallRow, input: unknown) {
  const visitId = id(record(input).besok_id);
  const own = await ownVisitForChange(deps, c, visitId);
  if ("fel" in own || !visitId) return "fel" in own ? own : { fel: "okant_besok" };
  try {
    const r = await changeBooking(
      deps,
      {
        tenantId: c.tenantId,
        actor: { type: "customer", id: own.customerId },
        idempotencyKey: `call:${c.id}:cancel:${visitId}`,
      },
      visitId,
      { event: "cancel", reason: "phone" },
    );
    return { besok_id: r.visit.id, status: r.visit.status };
  } catch (error) {
    return changeRefusal(error);
  }
}

const LINK_TEMPLATE = {
  bokning: "voice_booking_link",
  atkomst: "voice_access_link",
  bilder: "voice_pictures_link",
  typskylt: "f15_type_plate",
} as const;

/**
 * skicka_lank: an sms to the caller with the booking's own link, where codes and pictures are
 * entered and the booking seen. Always to the call's number (or, when it is hidden, the proven
 * customer's), never to a number the model names.
 */
export async function skickaLank(deps: VoiceDeps, c: CallRow, input: unknown) {
  const type = record(input).typ;
  if (type !== "bokning" && type !== "atkomst" && type !== "bilder" && type !== "typskylt") {
    return { fel: "okand_typ" };
  }
  const who = identified(c);
  let to = c.callerNumber;
  if (!to && c.verifiedCustomerId) {
    const [v] = await deps.db
      .select({ phone: customer.phone })
      .from(customer)
      .where(eq(customer.id, c.verifiedCustomerId));
    to = v?.phone ?? null;
  }
  if (!to) return { fel: "inget_nummer" };
  if (!who) return { fel: "ingen_bokning" };
  // The visit the link is for: the one this call booked, else the customer's next.
  const visitId = c.jobId
    ? (
        await deps.db
          .select({ id: visit.id })
          .from(visit)
          .where(and(eq(visit.tenantId, c.tenantId), eq(visit.jobId, c.jobId)))
          .orderBy(asc(sql`lower(${visit.timeWindow})`))
          .limit(1)
      )[0]?.id
    : (await visitsOf(deps.db, c.tenantId, who, deps.now()))[0]?.id;
  if (!visitId) return { fel: "ingen_bokning" };
  const [v] = await deps.db
    .select({ start: sql<Date>`lower(${visit.timeWindow})`.mapWith((x: string) => new Date(x)) })
    .from(visit)
    .where(eq(visit.id, visitId));
  const [firm] = await deps.db
    .select({ name: tenant.name })
    .from(tenant)
    .where(eq(tenant.id, c.tenantId));
  const code = await createShortLink(deps.db, deps.linkKey, {
    tenantId: c.tenantId,
    visitId,
    purpose: "manage",
    expiresAt: manageLinkExpiry(v?.start ?? deps.now()),
  });
  const link = shortLinkUrl(deps.appBase, code);
  const queued = await queueSms(
    deps,
    { tenantId: c.tenantId, to, customerId: who, visitId },
    LINK_TEMPLATE[type],
    { link, firm: firm?.name ?? "" },
  );
  return queued.status === "queued" ? { ok: true } : { fel: "kunde_inte_skicka" };
}

/** satt_vantelista: the identified customer, or a new one by the call's number. */
export async function sattVantelista(deps: VoiceDeps, c: CallRow, input: unknown) {
  const i = record(input);
  const serviceTypeId = id(i.tjanst_id);
  if (!serviceTypeId) return { fel: "ogiltig_indata" };
  const [service] = await deps.db
    .select({ id: serviceType.id })
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, c.tenantId), eq(serviceType.id, serviceTypeId)));
  if (!service) return { fel: "okand_tjanst" };
  let who = identified(c);
  if (!who) {
    const name = text(i.namn, 120);
    const phone = c.callerNumber;
    if (!name || !phone) return { fel: name ? "mobilnummer_saknas" : "namn_saknas" };
    if (await customerByPhone(deps.db, c.tenantId, phone)) return { fel: "kontroll_kravs" };
    const [created] = await deps.db
      .insert(customer)
      .values({ tenantId: c.tenantId, name, phone, acquisitionChannel: "phone" })
      .returning({ id: customer.id });
    who = created?.id ?? null;
    if (!who) throw new Error("customer not created");
    await deps.db.update(call).set({ customerId: who }).where(eq(call.id, c.id));
  }
  const from = typeof i.fran === "string" && DATE.test(i.fran) ? i.fran : null;
  const to = typeof i.till === "string" && DATE.test(i.till) ? i.till : null;
  const [entry] = await deps.db
    .insert(waitlistEntry)
    .values({
      tenantId: c.tenantId,
      customerId: who,
      serviceTypeId,
      areaId: id(i.omrade_id),
      earliestDate: from,
      latestDate: to,
    })
    .returning({ id: waitlistEntry.id });
  return { ok: true, id: entry?.id };
}

/**
 * koppla_till_mekaniker: until the transfer with a whisper comes in step 6.4, the answer is
 * always `ej_svar`, so the agent takes a message (spec 8.4). The wish is logged on the call.
 */
export async function kopplaTillMekaniker(deps: VoiceDeps, c: CallRow, input: unknown) {
  const reason = text(record(input).skal, 300);
  await deps.db
    .update(call)
    .set({
      summary: sql`coalesce(${call.summary} || E'\n', '') || ${`Ville kopplas: ${reason ?? "–"}`}`,
    })
    .where(and(eq(call.tenantId, c.tenantId), eq(call.id, c.id)));
  return { status: "ej_svar" as const };
}

const MESSAGE_TYPE = {
  ring_upp: "call_back",
  akut: "emergency",
  reklamation: "call_back",
  foretag: "call_back",
  annat: "call_back",
} as const;

/** skapa_meddelande: a task for the firm with the call attached (push comes in step 6.4). */
export async function skapaMeddelande(deps: VoiceDeps, c: CallRow, input: unknown) {
  const i = record(input);
  const reason = i.skal;
  if (
    reason !== "ring_upp" &&
    reason !== "akut" &&
    reason !== "reklamation" &&
    reason !== "foretag" &&
    reason !== "annat"
  ) {
    return { fel: "ogiltig_indata" };
  }
  const body = text(i.text, 2000);
  if (!body) return { fel: "text_saknas" };
  const name = text(i.namn, 120);
  const who = identified(c);
  const title = `${reason === "reklamation" ? "Reklamation: " : reason === "akut" ? "Akut: " : ""}${
    name ?? (who ? "Kund" : (c.callerNumber ?? "Okänt nummer"))
  } ringde`;
  const taskId = await createTask(deps.db, {
    tenantId: c.tenantId,
    type: MESSAGE_TYPE[reason],
    priority: i.prioritet === "hog" ? "high" : "normal",
    title,
    note: body,
    customerId: who,
    callId: c.id,
    dueAt: new Date(deps.now().getTime() + (i.prioritet === "hog" ? 30 : 24 * 60) * MINUTE),
  });
  return { arende_id: taskId };
}

/** stoppa_inspelning: the caller said no to the recording. */
export async function stoppaInspelning(deps: VoiceDeps, c: CallRow) {
  await deps.db
    .update(call)
    .set({ recordingAllowed: false })
    .where(and(eq(call.tenantId, c.tenantId), eq(call.id, c.id)));
  return { ok: true };
}

const OUTCOMES = ["booked", "message", "transferred", "spam"] as const;

/** avsluta_samtal: summary and outcome; the call's token stops working. */
export async function avslutaSamtal(deps: VoiceDeps, c: CallRow, input: unknown) {
  const i = record(input);
  const outcome = OUTCOMES.find((o) => o === i.utfall) ?? null;
  await deps.db
    .update(call)
    .set({
      endedAt: deps.now(),
      outcome,
      summary: sql`coalesce(${call.summary} || E'\n', '') || ${text(i.sammanfattning, 2000) ?? ""}`,
    })
    .where(and(eq(call.tenantId, c.tenantId), eq(call.id, c.id)));
  return { ok: true };
}

/** What the system prompt says about the firm (spec 8.2 "Information om firman"). No addresses. */
export interface ReceptionistFacts {
  firma: string;
  assistentNamn: string;
  halsning: string | null;
  mekaniker: string;
  serviceomrade: string;
  ejServiceomraden: string[];
  oppettider: string;
  jourtider: string;
  svarslofte: string;
  /** Kronor excluding VAT, or null when the firm has not set it. */
  timpris: number | null;
  akuttillagg: number | null;
  tjanster: {
    id: string;
    namn: string;
    minuter: number;
    krav: string | null;
    pris: number | null;
  }[];
  platser: { id: string; namn: string; typ: string }[];
}

const kronor = (ore: number | null) => (ore === null ? null : Math.round(ore / 100));

/** The firm's facts for the receptionist's prompt, the same for every call to the firm. */
export async function receptionistFacts(
  db: Db,
  tenantId: string,
): Promise<ReceptionistFacts | null> {
  const [firm] = await db
    .select({ name: tenant.name, settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!firm) return null;
  const r = receptionistSettings(firm.settings);
  const booking = bookingSettings(firm.settings);
  const [mechanic] = await db
    .select({ name: appUser.name })
    .from(appUser)
    .where(
      and(
        eq(appUser.tenantId, tenantId),
        isNull(appUser.deletedAt),
        inArray(appUser.role, ["owner", "mechanic"]),
      ),
    )
    .orderBy(sql`${appUser.role} = 'owner' desc`, asc(appUser.createdAt))
    .limit(1);
  const services = await db
    .select({
      id: serviceType.id,
      name: serviceType.name,
      minutes: serviceType.defaultDurationMinutes,
      mode: serviceType.requiredMode,
      price: serviceType.priceOre,
    })
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, tenantId), isNull(serviceType.deletedAt)))
    .orderBy(asc(serviceType.name));
  const places = await db
    .select({ id: location.id, name: location.name, type: location.type })
    .from(location)
    .where(
      and(
        eq(location.tenantId, tenantId),
        isNull(location.deletedAt),
        inArray(location.type, ["marina", "club", "yard"]),
      ),
    )
    .orderBy(asc(location.name));
  return {
    firma: firm.name,
    assistentNamn: r.assistantName,
    halsning: r.greeting,
    mekaniker: mechanic ? firstName(mechanic.name) : firm.name,
    serviceomrade: r.serviceArea,
    ejServiceomraden: r.notServed,
    oppettider: r.openingHours,
    jourtider: r.onCallHours,
    svarslofte: r.answerPromise,
    timpris: kronor(booking.hourlyRateOre),
    akuttillagg: kronor(booking.emergencySurchargeOre),
    tjanster: services.map((s) => ({
      id: s.id,
      namn: s.name,
      minuter: s.minutes,
      krav: s.mode,
      pris: kronor(s.price),
    })),
    platser: places.map((p) => ({ id: p.id, namn: p.name, typ: p.type })),
  };
}
