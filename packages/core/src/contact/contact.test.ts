import { describe, expect, it } from "vitest";
import { isSwedishMobile, toE164 } from "./phone";

describe("toE164", () => {
  it.each([
    ["070-123 45 67", "+46701234567"],
    ["0701234567", "+46701234567"],
    ["+46 70 123 45 67", "+46701234567"],
    ["0046701234567", "+46701234567"],
    ["08-123 456 78", "+46812345678"],
    ["(08) 46 50 04 00", "+46846500400"],
  ])("%s → %s", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });

  it.each(["", "abc", "701234567", "070-12", "+46 70 123 45 67 89 01", "+0123456789"])(
    "refuses %j",
    (input) => {
      expect(toE164(input)).toBeNull();
    },
  );
});

describe("isSwedishMobile", () => {
  it("tells mobile numbers from landlines", () => {
    expect(isSwedishMobile("+46701234567")).toBe(true);
    expect(isSwedishMobile("+46731234567")).toBe(true);
    expect(isSwedishMobile("+46812345678")).toBe(false);
    expect(isSwedishMobile("+4791234567")).toBe(false);
  });
});
