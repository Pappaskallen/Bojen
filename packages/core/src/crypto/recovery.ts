import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Recovery codes for the second factor (byggplan step 2.8). Ten codes such as `K7QF-2MXD`,
 * shown once; only a hash bound to the staff member is stored. A code works once.
 */
export const RECOVERY_CODE_COUNT = 10;
// No 0/O or 1/I/L, so codes can be read aloud and typed from paper.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newRecoveryCodes(randomBytes: (n: number) => Uint8Array): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

/** Upper case without spaces or dashes, so `k7qf 2mxd` matches `K7QF-2MXD`. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export function hashRecoveryCode(code: string, appUserId: string): string {
  return createHash("sha256")
    .update(`${appUserId}:${normalizeRecoveryCode(code)}`)
    .digest("hex");
}

export function recoveryCodeMatches(code: string, appUserId: string, storedHash: string): boolean {
  const given = Buffer.from(hashRecoveryCode(code, appUserId), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
