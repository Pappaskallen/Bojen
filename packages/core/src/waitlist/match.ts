/**
 * Which waiting customers get an offer for a freed time, in what order and in which round
 * (F4, spec part 1, chapter 7; byggplan step 4.3). Pure: the worker fetches the rows and
 * carries out the offers.
 */
import { crowFliesMeters, type GeoPoint } from "../scheduling/travel";
import { modeSatisfies, type PlacementMode } from "../scheduling/suggest";

/** A freed time: a cancelled visit's place and time. */
export interface FreedSlot {
  start: Date;
  end: Date;
  /** Stockholm date of the start, `YYYY-MM-DD`. */
  day: string;
  locationId: string | null;
  areaId: string | null;
  position: GeoPoint | null;
}

/** A waiting customer, with what the match needs about them and their boat. */
export interface Candidate {
  entryId: string;
  customerId: string;
  /** The entry's own area, if the customer named one. */
  areaId: string | null;
  /** From the entry's service. An entry without a service is never offered a time. */
  serviceMinutes: number | null;
  requiredMode: PlacementMode | null;
  earliestDate: string | null;
  latestDate: string | null;
  createdAt: Date;
  /** Where the boat is on the day of the freed time, if it is placed. */
  boat: { locationId: string; position: GeoPoint | null; mode: PlacementMode } | null;
  /** Visits done for the customer; the last tie-break, "customer value". */
  doneVisits: number;
}

export const NEARBY_METERS = 10_000;
export const ROUND_SIZE = 5;
export const ROUND_MINUTES = 60;
export const MAX_ROUNDS = 3;
/** F4 starts only for a time more than this many hours ahead. */
export const TRIGGER_HOURS = 2;
/** No further round starts later than this many hours before the start. */
export const LAST_ROUND_HOURS = 3;

const HOUR = 3_600_000;

export interface Ranked<C extends Candidate = Candidate> {
  candidate: C;
  /** The boat lies at the freed place itself: the offer says "på", otherwise "nära". */
  samePlace: boolean;
}

/** Whether the time is placed where the customer wants it: the same area, or within 10 km. */
function nearEnough(slot: FreedSlot, c: Candidate): boolean {
  if (c.areaId && slot.areaId && c.areaId === slot.areaId) return true;
  if (c.boat && slot.locationId && c.boat.locationId === slot.locationId) return true;
  const here = c.boat?.position;
  return Boolean(here && slot.position && crowFliesMeters(here, slot.position) <= NEARBY_METERS);
}

/**
 * The customers the time suits, best first: the same marina, then the longest wait, then the
 * most done visits. A time suits when the area or the distance fits, the service fits in the
 * time, the boat's mode meets the service's requirement and the day lies in the customer's
 * dates.
 */
export function rankCandidates<C extends Candidate>(
  slot: FreedSlot,
  candidates: readonly C[],
): Ranked<C>[] {
  const minutes = (slot.end.getTime() - slot.start.getTime()) / 60_000;
  const suits = (c: C) =>
    c.serviceMinutes !== null &&
    c.serviceMinutes <= minutes &&
    (!c.earliestDate || c.earliestDate <= slot.day) &&
    (!c.latestDate || slot.day <= c.latestDate) &&
    (!c.boat || modeSatisfies(c.requiredMode, c.boat.mode)) &&
    nearEnough(slot, c);
  const samePlace = (c: C) =>
    Boolean(c.boat && slot.locationId && c.boat.locationId === slot.locationId);
  return candidates
    .filter(suits)
    .map((candidate) => ({ candidate, samePlace: samePlace(candidate) }))
    .sort(
      (a, b) =>
        Number(b.samePlace) - Number(a.samePlace) ||
        a.candidate.createdAt.getTime() - b.candidate.createdAt.getTime() ||
        b.candidate.doneVisits - a.candidate.doneVisits ||
        a.candidate.entryId.localeCompare(b.candidate.entryId),
    );
}

/** The next batch: the first `ROUND_SIZE` who have not been offered this time before. */
export function nextBatch<C extends Candidate>(
  ranked: readonly Ranked<C>[],
  offered: ReadonlySet<string>,
): Ranked<C>[] {
  return ranked.filter((r) => !offered.has(r.candidate.customerId)).slice(0, ROUND_SIZE);
}

/** F4 starts when the freed time lies more than two hours ahead. */
export function waitlistStarts(start: Date, now: Date): boolean {
  return start.getTime() - now.getTime() > TRIGGER_HOURS * HOUR;
}

/**
 * When the next round goes, or null: an hour after this one, at most three rounds, and not
 * later than three hours before the start.
 */
export function nextRoundAt(round: number, sentAt: Date, start: Date): Date | null {
  if (round >= MAX_ROUNDS) return null;
  const at = new Date(sentAt.getTime() + ROUND_MINUTES * 60_000);
  return at.getTime() <= start.getTime() - LAST_ROUND_HOURS * HOUR ? at : null;
}
