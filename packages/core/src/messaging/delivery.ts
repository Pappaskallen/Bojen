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

export function inQuietHours(instant: Date): boolean {
  const time = hhmm(instant);
  return time >= QUIET_FROM || time < QUIET_UNTIL;
}

/** The first moment from `instant` on when a message of `category` may go out. */
/** Codes and the STOPP receipt go out whatever the list says: the person just asked. */
export function ignoresOptOut(category: MessageCategory): boolean {
  return category === "code" || category === "receipt";
}

export function earliestSend(instant: Date, category: MessageCategory): Date {
  if (category !== "notice" && category !== "marketing") return instant;
  if (!inQuietHours(instant)) return instant;
  const day = stockholmDate(instant);
  const morning = hhmm(instant) < QUIET_UNTIL ? day : addDays(day, 1);
  return stockholmInstant(morning, QUIET_UNTIL);
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
  now: Date;
}): DeliveryPlan {
  if (!input.to) return { action: "block", reason: "no_address" };
  if (input.optedOut && !ignoresOptOut(input.category))
    return { action: "block", reason: "opted_out" };
  const wanted = input.wanted && input.wanted > input.now ? input.wanted : input.now;
  return { action: "send", at: earliestSend(wanted, input.category) };
}

/**
 * The stored form of an opted-out number (spec 10.4: kept permanently, as a hash). Keyed
 * with a server secret, since phone numbers are few enough to guess one by one.
 */
export function optOutHash(key: string, tenantId: string, phoneE164: string): string {
  return createHmac("sha256", key).update(`${tenantId}:${phoneE164}`).digest("base64url");
}
