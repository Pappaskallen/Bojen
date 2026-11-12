import { describe, expect, it } from "vitest";
import { CODE_MAX_ATTEMPTS, checkCode, hashCode, newCode } from "./otp";
import { signSession, verifySession } from "./session";

const now = new Date("2027-04-01T08:00:00Z");
const stored = (over: Partial<Parameters<typeof checkCode>[0]> = {}) => ({
  id: "rec-1",
  codeHash: hashCode("123456", "rec-1"),
  expiresAt: new Date("2027-04-01T08:10:00Z"),
  attempts: 0,
  consumedAt: null,
  ...over,
});

describe("one-time codes", () => {
  it("makes six digits, keeping leading zeros", () => {
    expect(newCode(() => 42)).toBe("000042");
    expect(newCode(() => 999_999)).toBe("999999");
  });

  it("checks a code against its hash", () => {
    expect(checkCode(stored(), "123456", now)).toBe("ok");
    expect(checkCode(stored(), " 123456 ", now)).toBe("ok");
    expect(checkCode(stored(), "654321", now)).toBe("wrong");
    // The hash is bound to the record, so it does not work for another one.
    expect(checkCode(stored({ id: "rec-2" }), "123456", now)).toBe("wrong");
  });

  it("refuses expired, used and over-tried codes", () => {
    expect(checkCode(stored(), "123456", new Date("2027-04-01T08:10:00Z"))).toBe("expired");
    expect(checkCode(stored({ consumedAt: now }), "123456", now)).toBe("used");
    expect(checkCode(stored({ attempts: CODE_MAX_ATTEMPTS }), "123456", now)).toBe(
      "too_many_attempts",
    );
  });
});

describe("booking session", () => {
  const secret = "s".repeat(32);
  const token = signSession({ tenantId: "t1", customerId: "c1" }, secret, now);

  it("round-trips and expires after an hour", () => {
    expect(verifySession(token, secret, now)).toMatchObject({ tenantId: "t1", customerId: "c1" });
    expect(verifySession(token, secret, new Date("2027-04-01T09:00:00Z"))).toBeNull();
  });

  it("refuses forged or changed tokens", () => {
    expect(verifySession(token, "x".repeat(32), now)).toBeNull();
    const [body, sig] = token.split(".");
    const other = Buffer.from(
      JSON.stringify({ tenantId: "t1", customerId: "c2", exp: 9e9 }),
    ).toString("base64url");
    expect(verifySession(`${other}.${sig}`, secret, now)).toBeNull();
    expect(verifySession(`${body}`, secret, now)).toBeNull();
    expect(verifySession("garbage", secret, now)).toBeNull();
  });

  it("needs a long secret", () => {
    expect(() => signSession({ tenantId: "t", customerId: "c" }, "short", now)).toThrow();
  });
});
