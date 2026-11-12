/**
 * HTTP handlers for the public booking page (byggplan step 2.5). The firm comes from the
 * link; a signed-in customer carries a short-lived token from the sms code in the
 * `Authorization` header. A header, not a cookie, so the page also works inside the widget's
 * iframe on the mechanic's own site, where third-party cookies are blocked.
 *
 *   POST /api/boka/{firm}/code          { phone }                → 204
 *   POST /api/boka/{firm}/verify        { phone, code }          → { token, boats }
 *   GET  /api/boka/{firm}/address?q=…                            → { results }
 *   POST /api/boka/{firm}/suggestions   { serviceTypeId, place, mode, changeDate? } → { suggestions }
 *   POST /api/boka/{firm}/book          multipart: data (JSON) + photos              → 201 { visit }
 */
import type {
  GeoPoint,
  Geocoder,
  MapsProvider,
  ObjectStorage,
  PlacementMode,
  SmsSender,
} from "@bojen/core";
import { signSession, verifySession } from "@bojen/core/crypto";
import {
  BookingError,
  MAX_PHOTOS,
  customerBoats,
  findFirm,
  publicCatalog,
  publicSuggestions,
  requestCode,
  searchAddress,
  submitPublicBooking,
  verifyCode,
  type Database,
  type Firm,
  type NewBoat,
  type Photo,
  type PublicBookingInput,
} from "@bojen/db";

export interface PublicDeps {
  db: () => Database;
  sms: () => SmsSender;
  maps: () => MapsProvider;
  geocoder: () => Geocoder;
  storage: () => ObjectStorage;
  now: () => Date;
  sessionSecret: () => string;
}

const MODES: readonly PlacementMode[] = ["water", "land", "indoor"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STATUS: Record<string, number> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_transition: 409,
  too_late: 409,
  idempotency_mismatch: 422,
};

class BadRequest extends Error {}

const json = (body: unknown, status = 200) => Response.json(body, { status });

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new BadRequest("body");
  return value as Record<string, unknown>;
};
const text = (value: unknown, field: string, max = 200): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequest(field);
  return value;
};
const optionalText = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.trim() ? value.slice(0, max) : null;
const uuid = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequest(field);
  return value;
};
const day = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DAY.test(value)) throw new BadRequest(field);
  return value;
};
const mode = (value: unknown): PlacementMode => {
  if (!MODES.includes(value as PlacementMode)) throw new BadRequest("mode");
  return value as PlacementMode;
};
function point(value: unknown, field: string): GeoPoint {
  const p = record(value);
  const { lng, lat } = p;
  if (
    typeof lng !== "number" ||
    typeof lat !== "number" ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw new BadRequest(field);
  }
  return { lng, lat };
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  return record(await request.json().catch(() => undefined));
}

export function createPublicRoutes(deps: PublicDeps) {
  async function withFirm(
    slug: string,
    work: (firm: Firm) => Promise<Response>,
  ): Promise<Response> {
    try {
      const firm = await findFirm(deps.db(), slug);
      if (!firm) return json({ error: "not_found", detail: "firm" }, 404);
      return await work(firm);
    } catch (error) {
      if (error instanceof BadRequest)
        return json({ error: "invalid_input", detail: error.message }, 400);
      if (error instanceof BookingError) {
        return json(
          { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
          STATUS[error.code] ?? 400,
        );
      }
      throw error;
    }
  }

  /** The customer behind the token, if it is valid for this firm. */
  function session(request: Request, firm: Firm) {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    const s = verifySession(token, deps.sessionSecret(), deps.now());
    return s && s.tenantId === firm.tenantId ? s : null;
  }

  const today = () =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(deps.now());

  return {
    code: (request: Request, slug: string) =>
      withFirm(slug, async (firm) => {
        const b = await readJson(request);
        await requestCode(
          { db: deps.db(), sms: deps.sms(), now: deps.now },
          firm,
          text(b.phone, "phone", 30),
        );
        return new Response(null, { status: 204 });
      }),

    verify: (request: Request, slug: string) =>
      withFirm(slug, async (firm) => {
        const b = await readJson(request);
        const result = await verifyCode(
          { db: deps.db(), now: deps.now },
          firm.tenantId,
          text(b.phone, "phone", 30),
          text(b.code, "code", 10),
        );
        if (!result.ok) return json({ error: "invalid_code", detail: result.reason }, 401);
        const token = signSession(
          { tenantId: firm.tenantId, customerId: result.customerId },
          deps.sessionSecret(),
          deps.now(),
        );
        const boats = await customerBoats(deps.db(), firm.tenantId, result.customerId, today());
        return json({ token, boats });
      }),

    address: (request: Request, slug: string) =>
      withFirm(slug, async (firm) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        if (q.length > 120) throw new BadRequest("q");
        const { places } = await publicCatalog(deps.db(), firm.tenantId);
        const results = await searchAddress(deps.geocoder(), q, places[0]?.position);
        return json({ results });
      }),

    suggestions: (request: Request, slug: string) =>
      withFirm(slug, async (firm) => {
        const b = await readJson(request);
        const place = record(b.place);
        const suggestions = await publicSuggestions(
          { db: deps.db(), maps: deps.maps(), now: deps.now },
          firm.tenantId,
          {
            serviceTypeId: uuid(b.serviceTypeId, "serviceTypeId"),
            place:
              place.locationId !== undefined
                ? { locationId: uuid(place.locationId, "locationId") }
                : { position: point(place.position, "position") },
            mode: mode(b.mode),
            changeDate: day(b.changeDate, "changeDate"),
            earliest: day(b.earliest, "earliest"),
          },
        );
        return json({ suggestions });
      }),

    book: (request: Request, slug: string) =>
      withFirm(slug, async (firm) => {
        const key = request.headers.get("idempotency-key");
        if (!key) throw new BadRequest("Idempotency-Key");
        const form = await request.formData().catch(() => null);
        if (!form) throw new BadRequest("body");
        const data = record(JSON.parse(String(form.get("data") ?? "null")) as unknown);

        const signedIn = session(request, firm);
        const c = record(data.customer);
        const customer: PublicBookingInput["customer"] =
          // A signed-in customer is who the token says, never an id from the form.
          c.signedIn === true
            ? (() => {
                if (!signedIn) throw new BookingError("forbidden");
                return { id: signedIn.customerId };
              })()
            : {
                name: text(c.name, "name", 120),
                phone: text(c.phone, "phone", 30),
                email: optionalText(c.email),
              };

        const bt = record(data.boat);
        const boat: { id: string } | NewBoat =
          bt.id !== undefined
            ? { id: uuid(bt.id, "boatId") }
            : {
                name: optionalText(bt.name),
                make: optionalText(bt.make),
                model: optionalText(bt.model),
                engineMake: optionalText(bt.engineMake),
                engineModel: optionalText(bt.engineModel),
                engineHours: typeof bt.engineHours === "number" ? bt.engineHours : null,
              };

        const pl = record(data.place);
        const place: PublicBookingInput["place"] =
          pl.locationId !== undefined
            ? { locationId: uuid(pl.locationId, "locationId") }
            : { address: text(pl.address, "address"), position: point(pl.position, "position") };

        const files = form
          .getAll("photos")
          .filter((f): f is File => f instanceof File && f.size > 0);
        if (files.length > MAX_PHOTOS) throw new BadRequest("photos");
        const photos: Photo[] = await Promise.all(
          files.map(async (f) => ({
            bytes: new Uint8Array(await f.arrayBuffer()),
            contentType: f.type,
          })),
        );

        const start = new Date(text(data.start, "start", 40));
        if (Number.isNaN(start.getTime())) throw new BadRequest("start");
        const result = await submitPublicBooking(
          { db: deps.db(), storage: deps.storage(), now: deps.now },
          firm,
          key,
          {
            serviceTypeId: uuid(data.serviceTypeId, "serviceTypeId"),
            mechanicId: uuid(data.mechanicId, "mechanicId"),
            start,
            customer,
            boat,
            place,
            mode: mode(data.mode),
            changeDate: day(data.changeDate, "changeDate"),
            notes: optionalText(data.notes, 2000),
            photos,
          },
        );
        return json({ visit: result.visit, photosSaved: result.photosSaved }, 201);
      }),
  };
}
