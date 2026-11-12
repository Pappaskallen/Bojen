import { createHash, timingSafeEqual } from "node:crypto";

/**
 * One-time codes by sms for customers who already exist (byggplan step 2.5, spec 10.6).
 * Six digits, valid for 10 minutes and 5 attempts, at most 3 codes per number and hour.
 * Only a salted hash is stored. Pure: the random source and `now` are passed in.
 */
export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const CODES_PER_HOUR = 3;

/** Six digits from a source of random integers in [0, 1 000 000). */
export function newCode(randomInt: (max: number) => number): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
}

/** The code bound to its record id, so a hash cannot be reused for another record. */
export function hashCode(code: string, recordId: string): string {
  return createHash("sha256").update(`${recordId}:${code}`).digest("hex");
}

export interface StoredCode {
  id: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type CodeCheck = "ok" | "wrong" | "expired" | "too_many_attempts" | "used";

export function checkCode(stored: StoredCode, code: string, now: Date): CodeCheck {
  if (stored.consumedAt) return "used";
  if (stored.expiresAt.getTime() <= now.getTime()) return "expired";
  if (stored.attempts >= CODE_MAX_ATTEMPTS) return "too_many_attempts";
  const given = Buffer.from(hashCode(code.trim(), stored.id), "hex");
  const expected = Buffer.from(stored.codeHash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? "ok" : "wrong";
}
