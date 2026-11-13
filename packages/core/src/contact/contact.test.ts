import { describe, expect, it } from "vitest";
import { formatPhone, isSwedishMobile, toE164 } from "./phone";

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

describe("formatPhone", () => {
  it.each([
    ["+46701740601", "070-174 06 01"],
    ["+46761234567", "076-123 45 67"],
    ["+46731234567", "073-123 45 67"],
    ["+4686500400", "08-650 04 00"],
    ["+46812345678", "08-123 456 78"],
    ["+468123456", "08-12 34 56"],
    ["+4640123456", "+4640123456"],
    ["+4790123456", "+4790123456"],
    ["not a number", "not a number"],
    ["", ""],
  ])("%s is shown as %s", (stored, shown) => {
    expect(formatPhone(stored)).toBe(shown);
  });

  it("can be typed back to the number it was made from", () => {
    for (const stored of ["+46701740601", "+4686500400", "+46812345678", "+468123456"]) {
      expect(toE164(formatPhone(stored))).toBe(stored);
    }
  });
});
