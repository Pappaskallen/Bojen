import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { ACCESS_WINDOW_MS, decideAccess } from "./access-rule";
import { DecryptionError, decryptField, encryptField, fieldAad } from "./cipher";
import { Secret } from "./secret";

const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";

describe("field encryption", () => {
  const key = randomBytes(32);
  const aad = fieldAad(tenantA, "access_info.code");

  it("round-trips a code", () => {
    const stored = encryptField(key, "4711#", aad);
    expect(decryptField(key, stored, aad)).toBe("4711#");
  });

  it("never stores the plaintext and uses a fresh IV each time", () => {
    const a = encryptField(key, "4711#", aad);
    const b = encryptField(key, "4711#", aad);
    expect(a.includes(Buffer.from("4711#"))).toBe(false);
    expect(a.equals(b)).toBe(false);
    expect(a[0]).toBe(1);
  });

  it("refuses the wrong key, another tenant, another field and tampering", () => {
    const stored = encryptField(key, "4711#", aad);
    expect(() => decryptField(randomBytes(32), stored, aad)).toThrow(DecryptionError);
    expect(() => decryptField(key, stored, fieldAad(tenantB, "access_info.code"))).toThrow(
      DecryptionError,
    );
    expect(() => decryptField(key, stored, fieldAad(tenantA, "access_info.key_location"))).toThrow(
      DecryptionError,
    );
    const tampered = Buffer.from(stored);
    tampered[tampered.length - 1]! ^= 0x01;
    expect(() => decryptField(key, tampered, aad)).toThrow(DecryptionError);
    expect(() => decryptField(key, Buffer.from([2, 0, 0]), aad)).toThrow(DecryptionError);
  });

  it("does not leak the plaintext in decryption errors", () => {
    const stored = encryptField(key, "4711#", aad);
    try {
      decryptField(randomBytes(32), stored, aad);
    } catch (error) {
      expect(String(error)).not.toContain("4711");
      expect(inspect(error)).not.toContain("4711");
    }
  });

  it("only accepts 32-byte keys", () => {
    expect(() => encryptField(randomBytes(16), "x", aad)).toThrow(/32 bytes/);
  });
});

describe("Secret", () => {
  it("shows the value only through reveal()", () => {
    const secret = new Secret("4711#");
    expect(secret.reveal()).toBe("4711#");
    expect(String(secret)).toBe("[redacted]");
    expect(`${secret}`).toBe("[redacted]");
    expect(JSON.stringify({ code: secret })).toBe('{"code":"[redacted]"}');
    expect(inspect({ code: secret })).not.toContain("4711");
  });
});

describe("access rule", () => {
  const start = new Date("2027-04-20T06:00:00Z");
  const mechanic = { userId: "m1", role: "mechanic" as const };
  const visit = { mechanicId: "m1", start };
  const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);

  it.each([
    ["at the start", 0, true],
    ["12 hours before", -ACCESS_WINDOW_MS, true],
    ["12 hours after", ACCESS_WINDOW_MS, true],
    ["one second too early", -ACCESS_WINDOW_MS - 1000, false],
    ["one second too late", ACCESS_WINDOW_MS + 1000, false],
    ["the day before at noon", -18 * 3600 * 1000, false],
  ])("the assigned mechanic %s: allowed = %s", (_label, offset, allowed) => {
    expect(decideAccess({ ...mechanic, visit, now: at(offset) }).allowed).toBe(allowed);
  });

  it("says why access is refused", () => {
    expect(decideAccess({ ...mechanic, visit, now: at(-2 * ACCESS_WINDOW_MS) })).toEqual({
      allowed: false,
      reason: "outside_window",
    });
    expect(decideAccess({ userId: "m2", role: "mechanic", visit, now: start })).toEqual({
      allowed: false,
      reason: "not_assigned",
    });
    expect(
      decideAccess({
        userId: "m1",
        role: "mechanic",
        visit: { mechanicId: null, start },
        now: start,
      }),
    ).toEqual({ allowed: false, reason: "not_assigned" });
    expect(decideAccess({ userId: "a1", role: "admin", visit, now: start })).toEqual({
      allowed: false,
      reason: "role_not_allowed",
    });
  });

  it("lets the owner see the code at any time", () => {
    expect(
      decideAccess({ userId: "o1", role: "owner", visit, now: at(-30 * ACCESS_WINDOW_MS) }),
    ).toEqual({ allowed: true, reason: "owner" });
  });
});
