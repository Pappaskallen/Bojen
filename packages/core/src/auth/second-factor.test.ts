import { describe, expect, it } from "vitest";
import { hashRecoveryCode, newRecoveryCodes, recoveryCodeMatches } from "../crypto/recovery";
import { secondFactorRequired, secondFactorStep } from "./second-factor";

describe("second factor rules (spec 10.7)", () => {
  it.each([
    ["owner", false, true],
    ["admin", false, true],
    ["mechanic", false, false],
    ["mechanic", true, true],
  ] as const)("%s with factor %s → required %s", (role, hasFactor, expected) => {
    expect(secondFactorRequired({ role, hasFactor })).toBe(expected);
  });

  it("tells what to do next", () => {
    expect(secondFactorStep({ role: "owner", hasFactor: false, aal: "aal1" })).toBe("enroll");
    expect(secondFactorStep({ role: "owner", hasFactor: true, aal: "aal1" })).toBe("challenge");
    expect(secondFactorStep({ role: "owner", hasFactor: true, aal: "aal2" })).toBe("none");
    expect(secondFactorStep({ role: "mechanic", hasFactor: false, aal: "aal1" })).toBe("none");
  });
});

describe("recovery codes", () => {
  it("makes ten readable codes", () => {
    let n = 0;
    const codes = newRecoveryCodes((size) => Uint8Array.from({ length: size }, () => n++ % 256));
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(new Set(codes).size).toBe(10);
  });

  it("matches however the code is typed, and only for its owner", () => {
    const hash = hashRecoveryCode("K7QF-2MXD", "user-1");
    expect(recoveryCodeMatches("k7qf 2mxd", "user-1", hash)).toBe(true);
    expect(recoveryCodeMatches("K7QF-2MXE", "user-1", hash)).toBe(false);
    expect(recoveryCodeMatches("K7QF-2MXD", "user-2", hash)).toBe(false);
  });
});
