import {
  ROUND_MINUTES,
  LAST_ROUND_HOURS,
  dayMonth,
  nextBatch,
  nextRoundAt,
  promisedWindow,
  rankCandidates,
  bookingSettings,
  waitlistStarts,
  weekdayShort,
} from "@bojen/core";
import { earliestSend } from "@bojen/core/messaging";
import {
  BookingError,
  bookWaitlistEntry,
  createBooking,
  freedVisit,
  offersFor,
  queueSms,
  scheduleJob,
  slotTaken,
  tenant,
  waitlistCandidates,
  type Database,
  type FreedVisit,
  type WaitlistCandidate,
} from "@bojen/db";
import { eq } from "drizzle-orm";
import type { FlowDeps } from "./deps";

export const WAITLIST_TASK = "waitlist_round";

const HOUR = 3_600_000;

/** The firm's name and booking windows, for the offer text. */
async function firmOf(db: Database, tenantId: string) {
  const [row] = await db
    .select({ name: tenant.name, settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  return { name: row?.name ?? "", windows: bookingSettings(row?.settings).windows };
}

const roundKey = (visitId: string, round: number) => `waitlist:${visitId}:${String(round)}`;

/**
 * F4 starts when a visit is cancelled more than two hours before its start: the first round
 * of offers is put in at once, as a job, so a failure is retried.
 */
export async function startWaitlist(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
): Promise<"started" | "skipped"> {
  const freed = await freedVisit(deps.db, tenantId, visitId);
  if (freed?.status !== "cancelled" || !freed.mechanicId) return "skipped";
  if (!waitlistStarts(freed.slot.start, deps.now())) return "skipped";
  await scheduleJob(
    deps.db,
    WAITLIST_TASK,
    { tenantId, visitId, round: "1" },
    deps.now(),
    roundKey(visitId, 1),
  );
  return "started";
}

export type RoundOutcome = "offered" | "nobody" | "taken" | "too_late" | "skipped";

/**
 * One round of offers: the next five on the waitlist who suit the time and have not been
 * offered it, best first (the same marina, the longest wait, the most done visits). The next
 * round is put in an hour later, up to three rounds and three hours before the start, if
 * there is anyone left to ask.
 */
export async function sendWaitlistRound(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  round: number,
): Promise<RoundOutcome> {
  const freed = await freedVisit(deps.db, tenantId, visitId);
  if (freed?.status !== "cancelled" || !freed.mechanicId) return "skipped";
  if (await slotTaken(deps.db, tenantId, freed)) return "taken";

  const now = deps.now();
  const { start } = freed.slot;
  const late =
    round === 1
      ? !waitlistStarts(start, now)
      : start.getTime() - now.getTime() < LAST_ROUND_HOURS * HOUR;
  // An offer that would only leave after the quiet hours, too close to the start, is no use.
  const leavesAt = earliestSend(now, "notice");
  if (late || start.getTime() - leavesAt.getTime() < 2 * HOUR) return "too_late";

  const all = await waitlistCandidates(deps.db, tenantId, freed.slot, freed.customerId);
  const ranked = rankCandidates(freed.slot, all);
  const offered = new Set((await offersFor(deps.db, tenantId, visitId)).map((o) => o.customerId));
  const batch = nextBatch(ranked, offered);
  if (batch.length === 0) return "nobody";

  const firm = await firmOf(deps.db, tenantId);
  const window = promisedWindow(start, freed.slot.end, firm.windows);
  let sendAfter = now;
  for (const { candidate, samePlace } of batch) {
    const queued = await queueSms(
      deps,
      {
        tenantId,
        to: candidate.phone,
        customerId: candidate.customerId,
        visitId,
        ...(candidate.boatId ? { boatId: candidate.boatId } : {}),
      },
      "f4_offer",
      {
        weekday: weekdayShort(start),
        date: dayMonth(start),
        window,
        at: samePlace ? "på" : "nära",
        placeShort: freed.placeName ?? "",
        serviceShort: candidate.serviceName ?? "",
        boat: candidate.boatLabel,
        firm: firm.name,
      },
    );
    if (queued.status === "queued" && queued.sendAfter > sendAfter) sendAfter = queued.sendAfter;
  }

  const remaining = ranked.filter(
    (r) =>
      !offered.has(r.candidate.customerId) &&
      !batch.some((b) => b.candidate.customerId === r.candidate.customerId),
  );
  const next = remaining.length > 0 ? nextRoundAt(round, sendAfter, start) : null;
  if (next) {
    await scheduleJob(
      deps.db,
      WAITLIST_TASK,
      { tenantId, visitId, round: String(round + 1) },
      next,
      roundKey(visitId, round + 1),
    );
  }
  return "offered";
}

export type OfferAnswer = "booked" | "taken" | "declined" | "ignored";

/** Whether a customer's offer was sent within the last round's hour, so it can still be told. */
const open = (sentAt: Date | null, now: Date) =>
  sentAt !== null && now.getTime() - sentAt.getTime() < ROUND_MINUTES * 60_000;

/**
 * The answer to an offer. The first JA books the time for the customer's entry; the booking
 * is made as the customer, so the usual rules hold, and the mechanic's lock makes the first
 * one win: a later JA finds the time taken. Everyone else with an open offer is told that
 * the time is gone, and a JA that comes after that gets the same answer.
 */
export async function handleOfferAnswer(
  deps: FlowDeps,
  tenantId: string,
  visitId: string,
  customerId: string,
  intent: "yes" | "no",
): Promise<OfferAnswer> {
  if (intent === "no") return "declined";
  const freed = await freedVisit(deps.db, tenantId, visitId);
  if (freed?.status !== "cancelled" || !freed.mechanicId) return "ignored";
  const all = await waitlistCandidates(deps.db, tenantId, freed.slot, freed.customerId);
  const winner = all.find((c) => c.customerId === customerId);
  const offers = await offersFor(deps.db, tenantId, visitId);
  const own = offers.find((o) => o.customerId === customerId);
  if (!own) return "ignored";

  const tell = async (to: { customerId: string; phone: string; boatId: string | null }) => {
    await queueSms(
      deps,
      {
        tenantId,
        to: to.phone,
        customerId: to.customerId,
        visitId,
        ...(to.boatId ? { boatId: to.boatId } : {}),
      },
      "f4_taken",
      {},
    );
  };
  const taken = async (): Promise<OfferAnswer> => {
    await tell(own);
    return "taken";
  };

  // The booking itself is the test of whether the time is still free: the mechanic's lock
  // lets the first one in and refuses the rest, also when another booking has taken the time.
  if (!winner?.serviceTypeId) return taken();
  if (!(await book(deps, tenantId, freed, winner))) return taken();

  // The others who were asked and have not answered yet are told that the time is gone.
  const now = deps.now();
  for (const other of offers) {
    if (other.customerId === customerId || other.answered || !open(other.sentAt, now)) continue;
    await tell(other);
  }
  return "booked";
}

/** Books the freed time for the customer; false when someone else got there first. */
async function book(
  deps: FlowDeps,
  tenantId: string,
  freed: FreedVisit,
  winner: WaitlistCandidate,
): Promise<boolean> {
  if (!freed.mechanicId || !winner.serviceTypeId) return false;
  try {
    await createBooking(
      { db: deps.db, now: deps.now },
      {
        tenantId,
        actor: { type: "customer", id: winner.customerId },
        idempotencyKey: `waitlist:${freed.visitId}:${winner.customerId}`,
      },
      {
        customerId: winner.customerId,
        boatId: winner.boatId,
        serviceTypeId: winner.serviceTypeId,
        mechanicId: freed.mechanicId,
        start: freed.slot.start,
        channel: "waitlist",
        needsApproval: false,
        partsMissing: false,
      },
    );
  } catch (error) {
    if (error instanceof BookingError && error.code === "conflict") return false;
    throw error;
  }
  await bookWaitlistEntry(deps.db, tenantId, winner.entryId);
  return true;
}
