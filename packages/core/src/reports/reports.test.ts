import { describe, expect, it } from "vitest";
import { reportContent } from "./content";
import {
  MAX_WORK_POINTS,
  normaliseDraft,
  reportPrompt,
  workDonePoints,
  workDoneText,
  type ReportFacts,
} from "./draft";
import { formatKronor, invoiceTotals, parseKronor, proposedLines } from "./invoice";

const facts: ReportFacts = {
  service: "Vinterkonservering",
  description: "Motorn rycker lite på tomgång",
  boat: "Nimbus 3000",
  engines: [{ label: "Volvo Penta D3-220", hours: 412.5, previousHours: 380 }],
  parts: [
    { articleNumber: "21951346", description: "Impeller", quantity: 1, status: "installed" },
    { articleNumber: "3858160", description: "Bälgsats", quantity: 1, status: "needed" },
  ],
  notes: "Bytt olja och filter. Bälgen sliten.",
  voiceNotes: ["Impellern hade två skadade vingar."],
  photos: 2,
};

describe("the prompt for the draft", () => {
  it("holds the work done and nothing about who the customer is", () => {
    const text = reportPrompt(facts);
    expect(text).toContain("Vinterkonservering");
    expect(text).toContain("Volvo Penta D3-220: 412,5 h (förra: 380 h)");
    expect(text).toContain("Impeller (art.nr 21951346), antal 1, installed");
    expect(text).toContain("Bilder: 2");
    expect(text).toMatch(
      /<mechanic_notes>\nBytt olja och filter\. Bälgen sliten\.\n<\/mechanic_notes>/,
    );
    expect(text).toMatch(/<voice_notes>\nImpellern hade två skadade vingar\.\n<\/voice_notes>/);
  });

  it("says when nothing was recorded", () => {
    const text = reportPrompt({ ...facts, engines: [], parts: [], notes: null, voiceNotes: [] });
    expect(text).toContain("- inga registrerade");
    expect(text).toContain("<mechanic_notes>\n(inga)");
    expect(text).toContain("<voice_notes>\n(inga)");
  });
});

describe("the model's answer", () => {
  it("is trimmed, capped and given known priorities", () => {
    const draft = normaliseDraft({
      workDone: ["  Bytt olja  ", "", 7, ...Array.from({ length: 30 }, (_, i) => `p${String(i)}`)],
      recommendations: [
        { text: "Byt bälg", priority: "now" },
        { text: "Kolla zinken", priority: "urgent!" },
        { text: " ", priority: "now" },
        "fel",
      ],
      nextService: "  Vårservice v. 17 ",
    });
    expect(draft.workDone[0]).toBe("Bytt olja");
    expect(draft.workDone).toHaveLength(MAX_WORK_POINTS);
    expect(draft.recommendations).toEqual([
      { text: "Byt bälg", priority: "now" },
      { text: "Kolla zinken", priority: "monitor" },
    ]);
    expect(draft.nextService).toBe("Vårservice v. 17");
  });

  it("that is not an object is an empty draft", () => {
    expect(normaliseDraft("nej")).toEqual({ workDone: [], recommendations: [], nextService: null });
  });

  it("goes to text and back, one point per line, with bullets removed", () => {
    expect(workDonePoints("- Bytt olja\n\n• Bytt filter\r\n  * Smort styrning ")).toEqual([
      "Bytt olja",
      "Bytt filter",
      "Smort styrning",
    ]);
    expect(workDonePoints(workDoneText(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("the invoice basis", () => {
  it("is proposed from the price list: service, call-out and emergency surcharge", () => {
    expect(
      proposedLines({
        service: { name: "Felsökning", priceOre: 95_000 },
        calloutPriceOre: 69_500,
        emergencySurchargeOre: 180_000,
        urgency: "emergency",
      }),
    ).toEqual([
      { type: "labour", description: "Felsökning", hours: null, unitPriceOre: 95_000 },
      { type: "callout", description: "Framkörning", hours: null, unitPriceOre: 69_500 },
      { type: "emergency", description: "Akuttillägg", hours: null, unitPriceOre: 180_000 },
    ]);
  });

  it("has no line for a price the firm has not set, and no surcharge on a planned job", () => {
    expect(
      proposedLines({
        service: { name: "Felsökning", priceOre: null },
        calloutPriceOre: null,
        emergencySurchargeOre: 180_000,
        urgency: "planned",
      }),
    ).toEqual([]);
  });

  it("sums the lines and adds 25 % VAT, rounded on the total", () => {
    const totals = invoiceTotals([
      { type: "labour", description: "Arbete", quantity: 1.5, unitPriceOre: 95_000 },
      { type: "part", description: "Impeller", quantity: 2, unitPriceOre: 45_050 },
      { type: "discount", description: "Rabatt", quantity: 1, unitPriceOre: -10_001 },
    ]);
    expect(totals.lines.map((l) => l.amountOre)).toEqual([142_500, 90_100, -10_001]);
    expect(totals).toMatchObject({ netOre: 222_599, vatOre: 55_650, grossOre: 278_249 });
  });

  it("reads and writes kronor as Swedes do", () => {
    expect(parseKronor("950")).toBe(95_000);
    expect(parseKronor("1 234,50")).toBe(123_450);
    expect(parseKronor("-200 kr")).toBe(-20_000);
    expect(parseKronor("12,345")).toBeNull();
    expect(parseKronor("tusen")).toBeNull();
    expect(parseKronor("")).toBeNull();
    expect(formatKronor(123_450).replace(/\s/g, " ")).toBe("1 234,50 kr");
    expect(formatKronor(95_000)).toBe("950 kr");
  });
});

describe("the report in the e-mail", () => {
  it("has the points, hours, installed parts and recommendations as text", () => {
    const content = reportContent(
      {
        workDone: ["Bytt olja", "Bytt impeller"],
        recommendations: [{ text: "Byt bälgen", priority: "next_season" }],
        nextService: "Vårservice v. 17",
      },
      facts,
    );
    expect(content).toEqual({
      workDone: "- Bytt olja\n- Bytt impeller",
      hours: "Volvo Penta D3-220: 412,5 h",
      previousHours: "Volvo Penta D3-220: 380 h",
      parts: "- Impeller (art.nr 21951346) × 1",
      recommendations: "- Nästa säsong: Byt bälgen",
      nextService: "Vårservice v. 17",
    });
  });
});
