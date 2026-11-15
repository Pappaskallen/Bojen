/**
 * The marina card (byggplan step 5.3, spec C3): marinas, clubs and yards, with the people
 * there, the rules for getting in, the boats that are there and when they are launched and
 * hauled out, and the marina's own booking link. Read only, and never the codes themselves:
 * the card says whether a gate code or key box is stored, not what it is.
 */
import { stockholmDate } from "@bojen/core";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  location,
  locationAccessRule,
  locationContact,
  tenant,
} from "./schema";

type Db = Pick<Database, "select">;

/** The kinds of place that get a card: not private docks or someone's garden. */
export const PLACE_TYPES = ["marina", "club", "yard"] as const;

export interface PlaceRow {
  id: string;
  name: string;
  type: string;
  address: string | null;
  /** Boats placed here today. */
  boatsNow: number;
}

/** The firm's marinas, clubs and yards, alphabetical, with how many boats are there now. */
export async function listPlaces(db: Db, tenantId: string, now: Date): Promise<PlaceRow[]> {
  const today = stockholmDate(now);
  return db
    .select({
      id: location.id,
      name: location.name,
      type: location.type,
      address: location.address,
      // The outer columns by table name: a one-table query renders them unqualified.
      boatsNow: sql<number>`(
        select count(distinct bp.boat_id)::int from boat_placement bp
        join boat b on b.tenant_id = bp.tenant_id and b.id = bp.boat_id and b.deleted_at is null
        where bp.tenant_id = location.tenant_id and bp.location_id = location.id
          and bp.deleted_at is null and bp.valid_during @> ${today}::date)`,
    })
    .from(location)
    .where(
      and(
        eq(location.tenantId, tenantId),
        isNull(location.deletedAt),
        inArray(location.type, [...PLACE_TYPES]),
      ),
    )
    .orderBy(asc(location.name));
}

export interface PlaceContact {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
}

export interface PlaceBoat {
  boatId: string;
  name: string | null;
  make: string | null;
  model: string | null;
  season: string;
  mode: string;
  spotId: string | null;
  launchDate: string | null;
  haulOutDate: string | null;
  /** The boat is here today. */
  current: boolean;
  owners: { id: string; name: string }[];
}

/** How many boats go in or come up on a day. */
export interface PlaceDate {
  date: string;
  boats: number;
}

export interface PlaceCard {
  id: string;
  name: string;
  type: string;
  address: string | null;
  slug: string | null;
  accessMethod: string;
  crossingMinutes: number | null;
  /** The marina as a customer, when it is one (it may order jobs itself). */
  ownerCustomer: { id: string; name: string } | null;
  /** For the booking link `/boka/{firm}/m/{place}`; null when either has no slug. */
  bookingPath: string | null;
  contacts: PlaceContact[];
  rules: {
    openingHours: Record<string, string> | null;
    checkIn: string | null;
    parking: string | null;
    gateCode: boolean;
    keyBox: boolean;
  } | null;
  /** Here now first, then by name. */
  boats: PlaceBoat[];
  launches: PlaceDate[];
  haulOuts: PlaceDate[];
}

const asHours = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  return Object.keys(out).length > 0 ? out : null;
};

function countByDate(dates: (string | null)[]): PlaceDate[] {
  const counts = new Map<string, number>();
  for (const d of dates) if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, boats]) => ({ date, boats }));
}

/** Everything the marina card shows, or null when the place is not this firm's. */
export async function placeCard(
  db: Db,
  tenantId: string,
  locationId: string,
  now: Date,
): Promise<PlaceCard | null> {
  const [row] = await db
    .select({ place: location, firmSlug: tenant.slug })
    .from(location)
    .innerJoin(tenant, eq(tenant.id, location.tenantId))
    .where(
      and(eq(location.tenantId, tenantId), eq(location.id, locationId), isNull(location.deletedAt)),
    );
  if (!row) return null;
  const { place, firmSlug } = row;
  const today = stockholmDate(now);

  const [owner] = place.ownerCustomerId
    ? await db
        .select({ id: customer.id, name: customer.name })
        .from(customer)
        .where(
          and(
            eq(customer.tenantId, tenantId),
            eq(customer.id, place.ownerCustomerId),
            isNull(customer.deletedAt),
          ),
        )
    : [];

  const contacts = await db
    .select({
      id: locationContact.id,
      name: locationContact.name,
      role: locationContact.role,
      phone: locationContact.phone,
      email: locationContact.email,
      note: locationContact.note,
    })
    .from(locationContact)
    .where(
      and(
        eq(locationContact.tenantId, tenantId),
        eq(locationContact.locationId, locationId),
        isNull(locationContact.deletedAt),
      ),
    )
    .orderBy(asc(locationContact.name));

  const [rule] = await db
    .select({
      openingHours: locationAccessRule.openingHours,
      checkIn: locationAccessRule.checkInInstructions,
      parking: locationAccessRule.parking,
      gateCode: sql<boolean>`${locationAccessRule.gateCodeEncrypted} is not null`,
      keyBox: sql<boolean>`${locationAccessRule.keyBoxEncrypted} is not null`,
    })
    .from(locationAccessRule)
    .where(
      and(
        eq(locationAccessRule.tenantId, tenantId),
        eq(locationAccessRule.locationId, locationId),
        isNull(locationAccessRule.deletedAt),
      ),
    );

  const placed = await db
    .select({
      boatId: boat.id,
      name: boat.name,
      make: boat.make,
      model: boat.model,
      season: boatPlacement.season,
      mode: boatPlacement.mode,
      spotId: boatPlacement.spotId,
      launchDate: boatPlacement.launchDate,
      haulOutDate: boatPlacement.haulOutDate,
      current: sql<boolean>`${boatPlacement.validDuring} @> ${today}::date`,
    })
    .from(boatPlacement)
    .innerJoin(
      boat,
      and(
        eq(boat.tenantId, boatPlacement.tenantId),
        eq(boat.id, boatPlacement.boatId),
        isNull(boat.deletedAt),
      ),
    )
    .where(
      and(
        eq(boatPlacement.tenantId, tenantId),
        eq(boatPlacement.locationId, locationId),
        isNull(boatPlacement.deletedAt),
      ),
    );

  const boatIds = [...new Set(placed.map((p) => p.boatId))];
  const owners =
    boatIds.length === 0
      ? []
      : await db
          .select({ boatId: boatOwnership.boatId, id: customer.id, name: customer.name })
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
              inArray(boatOwnership.boatId, boatIds),
              isNull(boatOwnership.deletedAt),
            ),
          )
          .orderBy(asc(customer.name));

  const boats: PlaceBoat[] = placed
    .map((p) => ({
      ...p,
      owners: owners.filter((o) => o.boatId === p.boatId).map(({ id, name }) => ({ id, name })),
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        (a.name ?? "").localeCompare(b.name ?? "", "sv") ||
        a.boatId.localeCompare(b.boatId),
    );

  return {
    id: place.id,
    name: place.name,
    type: place.type,
    address: place.address,
    slug: place.slug,
    accessMethod: place.accessMethod,
    crossingMinutes: place.crossingMinutes,
    ownerCustomer: owner ?? null,
    bookingPath: firmSlug && place.slug ? `/boka/${firmSlug}/m/${place.slug}` : null,
    contacts,
    rules: rule
      ? {
          openingHours: asHours(rule.openingHours),
          checkIn: rule.checkIn,
          parking: rule.parking,
          gateCode: rule.gateCode,
          keyBox: rule.keyBox,
        }
      : null,
    boats,
    launches: countByDate(placed.map((p) => p.launchDate)),
    haulOuts: countByDate(placed.map((p) => p.haulOutDate)),
  };
}
