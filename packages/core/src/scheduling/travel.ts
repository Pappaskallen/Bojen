/**
 * Travel times between places (byggplan step 2.2, spec A4).
 *
 * A travel time is the drive on roads plus the crossing at each end that is reached by
 * the mechanic's own boat or by ferry. Only the drive comes from the maps provider and is
 * cached, per pair of places and departure hour. Crossings come from the places themselves,
 * so changing a crossing time never leaves a stale cache behind.
 *
 * Pure: the maps provider is an interface implemented in packages/adapters.
 */

export interface GeoPoint {
  lng: number;
  lat: number;
}

export type AccessMethod = "car" | "boat" | "ferry";

export interface TravelPlace {
  id: string;
  position: GeoPoint;
  accessMethod: AccessMethod;
  /** One way, by boat or ferry. Ignored when the place is reached by car. */
  crossingMinutes?: number | null;
}

/** The drive between two points on roads, as a maps provider returns it. */
export interface DriveLeg {
  originIndex: number;
  destinationIndex: number;
  seconds: number;
  meters: number;
}

/** Driving times from every origin to every destination, leaving at `departure`. */
export interface MapsProvider {
  readonly name: string;
  driveMatrix(
    origins: readonly GeoPoint[],
    destinations: readonly GeoPoint[],
    departure: Date,
  ): Promise<DriveLeg[]>;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const HOUR = 3_600_000;

/** Distance as the crow flies (haversine). */
export function crowFliesMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Roads are on average 1.4 times longer than the straight line. */
export const ROAD_FACTOR = 1.4;
/** Average speed in the archipelago, km/h. */
export const ESTIMATED_SPEED_KMH = 50;

/** The estimate the fake maps provider uses: crow flies × 1.4 at 50 km/h. */
export function estimateDrive(a: GeoPoint, b: GeoPoint): { seconds: number; meters: number } {
  const meters = Math.round(crowFliesMeters(a, b) * ROAD_FACTOR);
  const seconds = Math.round(meters / ((ESTIMATED_SPEED_KMH * 1000) / 3600));
  return { seconds, meters };
}

/** Start of the departure hour. Drives are cached per pair of places and this hour. */
export function departureHour(departure: Date): Date {
  return new Date(Math.floor(departure.getTime() / HOUR) * HOUR);
}

/** Seconds spent crossing to or from a place reached by boat or ferry, one way. */
export function crossingSeconds(place: Pick<TravelPlace, "accessMethod" | "crossingMinutes">) {
  if (place.accessMethod === "car") return 0;
  return (place.crossingMinutes ?? 0) * 60;
}

/**
 * Total travel time from one place to another. Leaving an island means crossing back, and
 * reaching one means crossing out, so each end that is not reached by car adds its crossing.
 * Staying at the same place takes no time.
 */
export function travelSeconds(from: TravelPlace, to: TravelPlace, driveSeconds: number): number {
  if (from.id === to.id) return 0;
  return driveSeconds + crossingSeconds(from) + crossingSeconds(to);
}

export interface PlacePair {
  fromId: string;
  toId: string;
}

export const pairKey = (p: PlacePair) => `${p.fromId}>${p.toId}`;

/**
 * The pairs that still need a drive from the maps provider: not cached, not the same place
 * twice, and each pair only once.
 */
export function missingPairs(
  pairs: readonly PlacePair[],
  cached: ReadonlySet<string>,
): PlacePair[] {
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const key = pairKey(p);
    if (p.fromId === p.toId || cached.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
