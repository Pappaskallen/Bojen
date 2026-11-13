import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, MAX_TERMS, containsPattern, parseSearch, phoneDigits } from "./query";

describe("phone numbers as typed", () => {
  it.each([
    ["0701740686", "46701740686"],
    ["070-174 06 86", "46701740686"],
    ["070 174 06 86", "46701740686"],
    ["+46 70 174 06 86", "46701740686"],
    ["+46701740686", "46701740686"],
    ["0046 70 174 06 86", "46701740686"],
    ["(070) 174 06 86", "46701740686"],
    ["08-650 04 00", "4686500400"],
  ])("%s is looked for as %s", (typed, digits) => {
    expect(phoneDigits(typed)).toBe(digits);
    expect(parseSearch(typed)).toEqual([{ text: typed, phone: digits }]);
  });

  it("looks for a part of a number where it is", () => {
    expect(parseSearch("174 06")).toEqual([{ text: "174 06", phone: "17406" }]);
    expect(parseSearch("0701")).toEqual([{ text: "0701", phone: "46701" }]);
  });

  it("does not take one or two digits for a phone number", () => {
    expect(parseSearch("12")).toEqual([{ text: "12", phone: null }]);
    expect(parseSearch("7")).toEqual([{ text: "7", phone: null }]);
  });

  it("also looks for digits in the text fields, since a model can be 3000", () => {
    expect(parseSearch("3000")).toEqual([{ text: "3000", phone: "3000" }]);
  });
});

describe("words", () => {
  it("splits on spaces; every word must match", () => {
    expect(parseSearch("Per Nimbus")).toEqual([
      { text: "Per", phone: null },
      { text: "Nimbus", phone: null },
    ]);
    expect(parseSearch("  Volvo   Penta D3  ")).toEqual([
      { text: "Volvo", phone: null },
      { text: "Penta", phone: null },
      { text: "D3", phone: null },
    ]);
  });

  it("keeps a word with digits and letters as text", () => {
    expect(parseSearch("D3-220")).toEqual([{ text: "D3-220", phone: null }]);
    expect(parseSearch("Nimbus 3000")).toEqual([
      { text: "Nimbus", phone: null },
      { text: "3000", phone: "3000" },
    ]);
  });

  it("handles å, ä and ö and marinas", () => {
    expect(parseSearch("Bullandö Marina")).toEqual([
      { text: "Bullandö", phone: null },
      { text: "Marina", phone: null },
    ]);
  });

  it("finds nothing to search for in an empty query", () => {
    expect(parseSearch("")).toEqual([]);
    expect(parseSearch("   \t\n ")).toEqual([]);
  });

  it("replaces control characters with spaces", () => {
    expect(parseSearch("Per\u0000Nimbus\u001f")).toEqual([
      { text: "Per", phone: null },
      { text: "Nimbus", phone: null },
    ]);
  });

  it("limits the length and the number of words", () => {
    const many = Array.from({ length: 20 }, (_, i) => `ord${String(i)}`).join(" ");
    expect(parseSearch(many).length).toBeLessThanOrEqual(MAX_TERMS);
    expect(parseSearch("x".repeat(500))[0]?.text.length).toBeLessThanOrEqual(40);
    const long = `${"a".repeat(60)} ${"b".repeat(60)}`;
    expect(
      parseSearch(long)
        .map((t) => t.text)
        .join(" ").length,
    ).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
  });
});

describe("the pattern", () => {
  it("finds the text anywhere", () => {
    expect(containsPattern("Nimbus")).toBe("%Nimbus%");
  });

  it("takes %, _ and backslash literally", () => {
    expect(containsPattern("100%")).toBe("%100\\%%");
    expect(containsPattern("a_b")).toBe("%a\\_b%");
    expect(containsPattern("a\\b")).toBe("%a\\\\b%");
  });
});
