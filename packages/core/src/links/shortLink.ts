/**
 * The customer's short links, `bojen.se/x/AbC12xYz` (byggplan step 3.4, spec part 1,
 * chapter 7). A code is 8 random characters from 62, about 2·10^14 possible codes, so it
 * cannot be guessed. Only a keyed hash of it is stored; the code is the only key to the page.
 */
import { createHmac, randomBytes } from "node:crypto";

export const SHORT_CODE_LENGTH = 8;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** The largest multiple of 62 below 256; bytes from here up are thrown away, so no bias. */
const LIMIT = 248;

export type LinkPurpose = "manage";

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

/** `bojen.se/x/AbC12xYz`, without a scheme, as in the sms texts. */
export function shortLinkUrl(base: string, code: string): string {
  const host = base.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${host}/x/${code}`;
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
