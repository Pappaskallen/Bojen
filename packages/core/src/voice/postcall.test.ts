import { describe, expect, it } from "vitest";
import { canonicalMake, normaliseNameplate, sameModel, worthSuggesting } from "../vision/nameplate";
import { CARD_MARK, PERSONAL_NUMBER_MARK, luhn, scrubSensitive } from "./scrub";
import { normaliseSummary, summaryText, transcriptText } from "./summarize";

describe("scrubbing a transcript", () => {
  it("takes out card numbers that pass the Luhn check, however they are grouped", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(scrubSensitive("Kortet är 4111 1111 1111 1111, går det?")).toBe(
      `Kortet är ${CARD_MARK}, går det?`,
    );
    expect(scrubSensitive("4111-1111-1111-1111")).toBe(CARD_MARK);
    // Sixteen digits that are not a card number stay.
    expect(scrubSensitive("Ordernummer 1234567812345678")).toBe("Ordernummer 1234567812345678");
  });

  it("takes out personal numbers, but never a phone number", () => {
    expect(scrubSensitive("Mitt personnummer är 811218-9876.")).toBe(
      `Mitt personnummer är ${PERSONAL_NUMBER_MARK}.`,
    );
    expect(scrubSensitive("19811218-9876")).toBe(PERSONAL_NUMBER_MARK);
    expect(scrubSensitive("198112189876")).toBe(PERSONAL_NUMBER_MARK);
    // A coordination number has 60 added to the day.
    expect(scrubSensitive("811278-9876")).toBe(PERSONAL_NUMBER_MARK);
    // Mobiles look like personal numbers without the hyphen; they stay.
    for (const phone of ["0701234567", "070-123 45 67", "+46701234567"]) {
      expect(scrubSensitive(`Ring ${phone}`)).toBe(`Ring ${phone}`);
    }
    // Not a date: stays.
    expect(scrubSensitive("811399-1234")).toBe("811399-1234");
  });
});

describe("the call's transcript and summary", () => {
  it("is the conversation as lines, without tool data or the opening placeholder, scrubbed", () => {
    expect(
      transcriptText([
        { role: "user", content: "(Samtalet kopplas upp.)" },
        { role: "assistant", content: "Hej och välkommen." },
        { role: "user", content: "Mitt kort är 4111 1111 1111 1111" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Kort tar vi inte." },
            { type: "tool_use", id: "t", name: "hamta_bokningar", input: {} },
          ],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "{}" }] },
      ]),
    ).toBe(
      `Receptionist: Hej och välkommen.\nKund: Mitt kort är ${CARD_MARK}\nReceptionist: Kort tar vi inte.`,
    );
  });

  it("is at most five points, scrubbed, with an outcome only of the known kinds", () => {
    const summary = normaliseSummary({
      points: ["Per ringde om Bustern", " ", "Pnr 811218-9876 sades", "3", "4", "5", "6"],
      outcome: "booked",
      intent: "book",
    });
    expect(summary.points).toEqual([
      "Per ringde om Bustern",
      `Pnr ${PERSONAL_NUMBER_MARK} sades`,
      "3",
      "4",
      "5",
    ]);
    expect(summary.outcome).toBe("booked");
    expect(summary.intent).toBe("book");
    expect(normaliseSummary({ points: "x", outcome: "sold", intent: "buy" })).toEqual({
      points: [],
      outcome: null,
      intent: null,
    });
    expect(summaryText({ points: ["a", "b"], outcome: null, intent: null })).toBe("- a\n- b");
  });
});

describe("a type plate", () => {
  it("is read in the firm's spelling of the make, and suggested only when the model is sure", () => {
    expect(canonicalMake("VOLVO")).toBe("Volvo Penta");
    expect(canonicalMake("mercury marine")).toBe("Mercury");
    expect(canonicalMake("Mercruiser")).toBe("MerCruiser");
    expect(canonicalMake("Okänd Motor AB")).toBe("Okänd Motor AB");
    const reading = normaliseNameplate({
      make: " volvo penta ",
      model: "D4-300",
      serialNumber: "2001 234567",
      confidence: 1.4,
    });
    expect(reading).toEqual({
      make: "Volvo Penta",
      model: "D4-300",
      serialNumber: "2001234567",
      confidence: 1,
    });
    expect(worthSuggesting(reading)).toBe(true);
    expect(worthSuggesting({ ...reading, confidence: 0.3 })).toBe(false);
    expect(worthSuggesting(normaliseNameplate({ confidence: 0.9 }))).toBe(false);
  });

  it("names the right model for the test with real plates", () => {
    const r = (make: string, model: string) => normaliseNameplate({ make, model, confidence: 0.9 });
    expect(sameModel(r("Volvo", "D4-300A"), { make: "Volvo Penta", model: "D4-300" })).toBe(true);
    expect(sameModel(r("Yamaha", "F 150"), { make: "Yamaha", model: "F150" })).toBe(true);
    expect(sameModel(r("Yamaha", "F115"), { make: "Yamaha", model: "F150" })).toBe(false);
    expect(sameModel(r("Suzuki", "DF150"), { make: "Honda", model: "DF150" })).toBe(false);
  });
});
