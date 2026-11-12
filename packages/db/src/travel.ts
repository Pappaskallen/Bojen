/**
 * Travel times between a firm's places, with a cache (byggplan step 2.2).
 *
 * Drives are read from `travel_cache` per pair of places and departure hour. Only the pairs
 * that are missing go to the maps provider, in one matrix request, and the answers are
 * stored. Crossings by boat or ferry are added from `location` afterwards.
 */
import {
  departureHour,
  missingPairs,
  pairKey,
  travelSeconds,
  type MapsProvider,
  type PlacePair,
  type TravelPlace,
} from "@bojen/core";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client";
import { location, travelCache } from "./schema";

type Executor = Pick<Database, "select" | "insert">;

export interface TravelDeps {
  db: Executor;
  maps: MapsProvider;
}

export interface TravelTime extends PlacePair {
  /** Drive plus crossings, in seconds. */
  seconds: number;
  driveSeconds: number;
  distanceMeters: number;
}

export class TravelError extends Error {
  constructor(
    readonly reason: "unknown_location" | "not_geocoded" | "no_route",
    readonly locationIds: string[],
  ) {
    super(`No travel time: ${reason}`);
    this.name = "TravelError";
  }
}

async function loadPlaces(db: Executor, tenantId: string, ids: string[]) {
  const rows = await db
    .select({
      id: location.id,
      position: location.position,
      accessMethod: location.accessMethod,
      crossingMinutes: location.crossingMinutes,
    })
    .from(location)
    .where(and(eq(location.tenantId, tenantId), inArray(location.id, ids)));

  const places = new Map<string, TravelPlace>();
  const notGeocoded: string[] = [];
  for (const row of rows) {
    if (!row.position) notGeocoded.push(row.id);
    else places.set(row.id, { ...row, position: row.position });
  }
  const unknown = ids.filter((id) => !places.has(id) && !notGeocoded.includes(id));
  if (unknown.length > 0) throw new TravelError("unknown_location", unknown);
  if (notGeocoded.length > 0) throw new TravelError("not_geocoded", notGeocoded);
  return places;
}

/** Travel times for the given pairs, leaving at `departure`. The result follows `pairs`. */
export async function travelTimes(
  deps: TravelDeps,
  tenantId: string,
  pairs: readonly PlacePair[],
  departure: Date,
): Promise<TravelTime[]> {
  const { db, maps } = deps;
  if (pairs.length === 0) return [];
  const hour = departureHour(departure);
  const ids = [...new Set(pairs.flatMap((p) => [p.fromId, p.toId]))];
  const places = await loadPlaces(db, tenantId, ids);

  const cachedRows = await db
    .select({
      fromId: travelCache.fromLocationId,
      toId: travelCache.toLocationId,
      driveSeconds: travelCache.driveSeconds,
      distanceMeters: travelCache.distanceMeters,
    })
    .from(travelCache)
    .where(
      and(
        eq(travelCache.tenantId, tenantId),
        eq(travelCache.departureHour, hour),
        inArray(travelCache.fromLocationId, ids),
        inArray(travelCache.toLocationId, ids),
      ),
    );
  const drives = new Map(cachedRows.map((r) => [pairKey(r), r]));

  const missing = missingPairs(pairs, new Set(drives.keys()));
  if (missing.length > 0) {
    const origins = [...new Set(missing.map((p) => p.fromId))];
    const destinations = [...new Set(missing.map((p) => p.toId))];
    const point = (id: string) => {
      const place = places.get(id);
      if (!place) throw new TravelError("unknown_location", [id]);
      return place.position;
    };
    const legs = await maps.driveMatrix(origins.map(point), destinations.map(point), hour);

    // Everything the provider answered is stored, also pairs nobody asked for yet.
    const fresh = legs.flatMap((leg) => {
      const fromId = origins[leg.originIndex];
      const toId = destinations[leg.destinationIndex];
      if (!fromId || !toId || fromId === toId) return [];
      return [{ fromId, toId, driveSeconds: leg.seconds, distanceMeters: leg.meters }];
    });
    if (fresh.length > 0) {
      await db
        .insert(travelCache)
        .values(
          fresh.map((f) => ({
            tenantId,
            fromLocationId: f.fromId,
            toLocationId: f.toId,
            departureHour: hour,
            driveSeconds: f.driveSeconds,
            distanceMeters: f.distanceMeters,
            provider: maps.name,
          })),
        )
        .onConflictDoNothing();
    }
    for (const f of fresh) drives.set(pairKey(f), f);
  }

  return pairs.map((pair) => {
    const from = places.get(pair.fromId);
    const to = places.get(pair.toId);
    if (!from || !to) throw new TravelError("unknown_location", [pair.fromId, pair.toId]);
    if (pair.fromId === pair.toId) {
      return { ...pair, seconds: 0, driveSeconds: 0, distanceMeters: 0 };
    }
    const drive = drives.get(pairKey(pair));
    if (!drive) throw new TravelError("no_route", [pair.fromId, pair.toId]);
    return {
      ...pair,
      seconds: travelSeconds(from, to, drive.driveSeconds),
      driveSeconds: drive.driveSeconds,
      distanceMeters: drive.distanceMeters,
    };
  });
}
