/**
 * The customer's short links, `bojen.app/x/AbC12xYz` (byggplan step 3.4, spec part 1,
 * chapter 7). A code is 8 random characters from 62, about 2·10^14 possible codes, so it
 * cannot be guessed. Only a keyed hash of it is stored; the code is the only key to the page.
 */
import { createHmac, randomBytes } from "node:crypto";

export const SHORT_CODE_LENGTH = 8;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** The largest multiple of 62 below 256; bytes from here up are thrown away, so no bias. */
const LIMIT = 248;

/**
 * `manage`: the booking's own page. `review`: the firm's review page after a good score in
 * F9, through `/r/{code}` so the click is counted (KPI 18, step 7.2).
 */
export type LinkPurpose = "manage" | "review";

/** A new code. `random` is only replaced in tests. */
export function newShortCode(random: (size: number) => Uint8Array = randomBytes): string {
  let code = "";
  while (code.length < SHORT_CODE_LENGTH) {
    for (const byte of random(SHORT_CODE_LENGTH * 2)) {
      if (byte < LIMIT && code.length < SHORT_CODE_LENGTH) code += ALPHABET[byte % 62];
    }
  }
  return code;
}

const CODE = new RegExp(`^[A-Za-z0-9]{${String(SHORT_CODE_LENGTH)}}$`);

/** Whether a string from a URL looks like a code at all, before any lookup. */
export function isShortCode(value: string): boolean {
  return CODE.test(value);
}

/** What the database stores instead of the code. */
export function linkHash(key: string, code: string): string {
  return createHmac("sha256", key).update(`short_link:${code}`).digest("base64url");
}

/** `bojen.app/x/AbC12xYz`, without a scheme, as in the sms texts. */
export function shortLinkUrl(base: string, code: string): string {
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${host}/x/${code}`;
}

/** `bojen.app/r/AbC12xYz`: the review link, which counts the click and goes on to the review. */
export function reviewLinkUrl(base: string, code: string): string {
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${host}/r/${code}`;
}

export type LinkState = "valid" | "expired" | "used";

/** A used link stays used; otherwise it is valid until it expires. */
export function linkState(link: { expiresAt: Date; usedAt: Date | null }, now: Date): LinkState {
  if (link.usedAt) return "used";
  return now.getTime() < link.expiresAt.getTime() ? "valid" : "expired";
}

/** A link to manage a booking works until the visit starts. */
export function manageLinkExpiry(visitStart: Date): Date {
  return visitStart;
}

/** A review link works for 90 days, as long as the next survey waits (F9). */
export const REVIEW_LINK_DAYS = 90;

export function reviewLinkExpiry(sentAt: Date): Date {
  return new Date(sentAt.getTime() + REVIEW_LINK_DAYS * 24 * 3_600_000);
}
