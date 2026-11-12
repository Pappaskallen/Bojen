import { addDays, daysBetween, stockholmDate } from "../time";
import {
  availableWindows,
  type BookingWindow,
  type BusyInterval,
  type OfferedWindow,
  type WorkPeriod,
} from "./availability";
import type { PlacePair } from "./travel";

/**
 * Ranked time suggestions for one job (byggplan step 2.3, spec 4.2 W3 and W4). The web
 * booking and the receptionist use the same function.
 *
 * score = extra drive (min) × 1.0 − marina bonus (30 if the mechanic is already at the
 *         place that day) + days of waiting × 2
 *
 * Lowest score first. Pure: travel times are passed in as a lookup, filled by the caller
 * with `travelPairsFor` and `travelTimes` in packages/db.
 */

export type PlacementMode = "water" | "land" | "indoor";

/** The boat's mode over time, for example in the water until haul-out and then on land. */
export interface ModePeriod {
  mode: PlacementMode;
  /** First and last day (`YYYY-MM-DD`), both included. Empty means open. */
  from?: string | null;
  to?: string | null;
}

/** A visit that holds time, with the place it is at. */
export interface PlannedVisit extends BusyInterval {
  locationId: string;
}

export type MarinaDayDiscount = { kind: "waive_callout" } | { kind: "percent"; percent: number };

export interface SuggestTenant {
  windows: readonly BookingWindow[];
  bufferMinutes: number;
  /** Suggestions that add more driving than this are not shown (W3). */
  maxExtraDriveMinutes: number;
  /** Given to the customer on a marina day. Empty means none. */
  marinaDayDiscount?: MarinaDayDiscount | null;
  /** Default 30. */
  marinaBonus?: number;
  /** Default 2 per day. */
  waitPenaltyPerDay?: number;
  schedule: readonly WorkPeriod[];
  blocks: readonly BusyInterval[];
  /** Booked visits, without cancelled ones. */
  visits: readonly PlannedVisit[];
  /** Where each mechanic's day starts and ends. A mechanic without one starts at the first job. */
  bases?: Readonly<Record<string, string>>;
}

export interface SuggestInput {
  tenant: SuggestTenant;
  serviceType: { durationMinutes: number; requiredMode?: PlacementMode | null };
  /** Where the boat is during the days searched. */
  location: { id: string };
  mode: readonly ModePeriod[];
  /** First day the customer wants (`YYYY-MM-DD`). */
  earliest: string;
  /** Days until missing parts arrive; 0 when everything is in stock. */
  partsLeadDays: number;
  /** Seconds from one place to another, crossings included. Same place is 0. */
  travel: (fromId: string, toId: string) => number | undefined;
  now: Date;
  /** Days searched from the first possible day. Default 28. */
  horizonDays?: number;
  /** Default 3. */
  limit?: number;
}

export interface Suggestion extends OfferedWindow {
  score: number;
  extraDriveMinutes: number;
  /** The mechanic already has a job at this place that day. */
  marinaDay: boolean;
  discount: MarinaDayDiscount | null;
}

export class MissingTravelTimeError extends Error {
  constructor(readonly pair: PlacePair) {
    super("A travel time is missing; fetch every pair from travelPairsFor first");
    this.name = "MissingTravelTimeError";
  }
}

const MINUTE = 60_000;

/** Whether a boat in `actual` mode meets the service's requirement. Indoors is on land. */
export function modeSatisfies(required: PlacementMode | null | undefined, actual: PlacementMode) {
  if (!required) return true;
  if (required === "land") return actual === "land" || actual === "indoor";
  return actual === required;
}

function modeOn(periods: readonly ModePeriod[], day: string): PlacementMode | undefined {
  return periods.find((p) => (!p.from || p.from <= day) && (!p.to || day <= p.to))?.mode;
}

/** First day a job can be booked: the customer's wish, and today + lead time + 1 (W4). */
export function firstPossibleDay(input: Pick<SuggestInput, "earliest" | "partsLeadDays" | "now">) {
  const today = stockholmDate(input.now);
  const candidates = [input.earliest, today];
  if (input.partsLeadDays > 0) candidates.push(addDays(today, input.partsLeadDays + 1));
  return candidates.reduce((a, b) => (a > b ? a : b));
}

/** Every pair of places `suggestSlots` may ask the travel lookup for. */
export function travelPairsFor(input: Pick<SuggestInput, "tenant" | "location">): PlacePair[] {
  const ids = new Set([
    input.location.id,
    ...input.tenant.visits.map((v) => v.locationId),
    ...Object.values(input.tenant.bases ?? {}),
  ]);
  const list = [...ids];
  return list.flatMap((fromId) =>
    list.filter((toId) => toId !== fromId).map((toId) => ({ fromId, toId })),
  );
}

export function suggestSlots(input: SuggestInput): Suggestion[] {
  const { tenant, serviceType, location } = input;
  const bonus = tenant.marinaBonus ?? 30;
  const waitPenalty = tenant.waitPenaltyPerDay ?? 2;
  const duration = serviceType.durationMinutes * MINUTE;

  const seconds = (fromId: string, toId: string) => {
    if (fromId === toId) return 0;
    const value = input.travel(fromId, toId);
    if (value === undefined) throw new MissingTravelTimeError({ fromId, toId });
    return value;
  };

  const today = stockholmDate(input.now);
  const first = firstPossibleDay(input);
  const last = addDays(first, (input.horizonDays ?? 28) - 1);
  const days = new Set(
    daysBetween(first, last).filter((day) => {
      const mode = modeOn(input.mode, day);
      return mode !== undefined && modeSatisfies(serviceType.requiredMode, mode);
    }),
  );
  if (days.size === 0) return [];

  // Each visit also holds the drive between it and the new place, in the right direction.
  const padded = tenant.visits.map((v) => ({
    mechanicId: v.mechanicId,
    start: new Date(v.start.getTime() - seconds(location.id, v.locationId) * 1000),
    end: new Date(v.end.getTime() + seconds(v.locationId, location.id) * 1000),
  }));

  const offers = availableWindows({
    from: first,
    to: last,
    durationMinutes: serviceType.durationMinutes,
    bufferMinutes: tenant.bufferMinutes,
    windows: tenant.windows,
    schedule: tenant.schedule,
    blocks: tenant.blocks,
    visits: padded,
    now: input.now,
  }).filter((o) => days.has(o.day));

  const scored = offers.map((offer): Suggestion => {
    const sameDay = tenant.visits
      .filter((v) => v.mechanicId === offer.mechanicId && stockholmDate(v.start) === offer.day)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const start = offer.earliestStart.getTime();
    const base = tenant.bases?.[offer.mechanicId];
    const prev = sameDay.filter((v) => v.end.getTime() <= start).at(-1)?.locationId ?? base;
    const next = sameDay.find((v) => v.start.getTime() >= start + duration)?.locationId ?? base;

    let extra = 0;
    if (prev) extra += seconds(prev, location.id);
    if (next) extra += seconds(location.id, next);
    if (prev && next) extra -= seconds(prev, next);
    const extraDriveMinutes = Math.round(extra / 60);

    const marinaDay = sameDay.some((v) => v.locationId === location.id);
    const waitDays = daysBetween(today, offer.day).length - 1;
    return {
      ...offer,
      extraDriveMinutes,
      marinaDay,
      discount: marinaDay ? (tenant.marinaDayDiscount ?? null) : null,
      score: extraDriveMinutes - (marinaDay ? bonus : 0) + waitDays * waitPenalty,
    };
  });

  // The customer sees windows, not mechanics: keep the best mechanic per day and window.
  const best = new Map<string, Suggestion>();
  for (const s of scored) {
    if (s.extraDriveMinutes > tenant.maxExtraDriveMinutes) continue;
    const key = `${s.day} ${s.label}`;
    const current = best.get(key);
    if (!current || compare(s, current) < 0) best.set(key, s);
  }
  return [...best.values()].sort(compare).slice(0, input.limit ?? 3);
}

function compare(a: Suggestion, b: Suggestion): number {
  return (
    a.score - b.score ||
    a.earliestStart.getTime() - b.earliestStart.getTime() ||
    a.mechanicId.localeCompare(b.mechanicId)
  );
}
