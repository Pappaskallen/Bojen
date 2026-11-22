import { createHmac } from "node:crypto";
import { addDays, stockholmDate, stockholmInstant } from "../time";
import type { MessageCategory } from "./templates";

/** Quiet hours in Stockholm (byggplan step 3.1): nothing but codes and replies goes out. */
export const QUIET_FROM = "21:00";
export const QUIET_UNTIL = "08:00";

const hhmm = (instant: Date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);

export function inQuietHours(instant: Date, until: string = QUIET_UNTIL): boolean {
  const time = hhmm(instant);
  return time >= QUIET_FROM || time < until;
}

/** The first moment from `instant` on when a message of `category` may go out. */
/** Codes and the STOPP receipt go out whatever the list says: the person just asked. */
export function ignoresOptOut(category: MessageCategory): boolean {
  return category === "code" || category === "receipt";
}

export function earliestSend(
  instant: Date,
  category: MessageCategory,
  until: string = QUIET_UNTIL,
): Date {
  if (category !== "notice" && category !== "marketing") return instant;
  if (!inQuietHours(instant, until)) return instant;
  const day = stockholmDate(instant);
  const morning = hhmm(instant) < until ? day : addDays(day, 1);
  return stockholmInstant(morning, until);
}

export type DeliveryPlan =
  { action: "send"; at: Date } | { action: "block"; reason: "opted_out" | "no_address" };

/**
 * What happens to an sms: sent now, held until the quiet hours end, or stopped because the
 * number replied STOPP. A code the person asked for is never held or stopped.
 */
export function planSms(input: {
  category: MessageCategory;
  to: string | null;
  optedOut: boolean;
  /** When the flow wants it sent; defaults to now. */
  wanted?: Date;
  /** End of the quiet hours for this sms (`quietUntilFor`); 08:00 by default. */
  quietUntil?: string;
  now: Date;
}): DeliveryPlan {
  if (!input.to) return { action: "block", reason: "no_address" };
  if (input.optedOut && !ignoresOptOut(input.category))
    return { action: "block", reason: "opted_out" };
  const wanted = input.wanted && input.wanted > input.now ? input.wanted : input.now;
  return { action: "send", at: earliestSend(wanted, input.category, input.quietUntil) };
}

/**
 * The stored form of an opted-out number (spec 10.4: kept permanently, as a hash). Keyed
 * with a server secret, since phone numbers are few enough to guess one by one.
 */
export function optOutHash(key: string, tenantId: string, phoneE164: string): string {
  return createHmac("sha256", key).update(`${tenantId}:${phoneE164}`).digest("base64url");
}

/**
 * Campaign sms per minute, for all firms together. 46elks sends 100 sms a minute per account
 * and queues the rest in order (read 2026-11-22), so a campaign round sent at once would hold
 * up a login code or a confirmation behind it. Campaigns take half; codes, notices and
 * replies have the other half.
 */
export const MARKETING_SMS_PER_MINUTE = 50;

/**
 * How far ahead of its earliest moment a campaign sms looks for the last one queued. A run
 * longer than this (18 000 sms at 50 a minute) is not spread past it; a campaign sms queued
 * for a later day does not push today's ones back.
 */
export const MARKETING_SPREAD_HORIZON_MS = 6 * 60 * 60_000;

/**
 * When a campaign sms goes out: at `earliest`, or one gap after the last campaign sms
 * already queued (`lastQueued`), whichever is later.
 */
export function marketingSlot(
  earliest: Date,
  lastQueued: Date | null,
  perMinute: number = MARKETING_SMS_PER_MINUTE,
): Date {
  if (!lastQueued) return earliest;
  const next = lastQueued.getTime() + Math.ceil(60_000 / perMinute);
  return next > earliest.getTime() ? new Date(next) : earliest;
}
