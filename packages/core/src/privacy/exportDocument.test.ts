import { describe, expect, it } from "vitest";
import {
  exportDocument,
  formatTimeWindow,
  stockholmDateTime,
  type CustomerExportData,
  type DocumentLine,
} from "./exportDocument";

const data: CustomerExportData = {
  exportedAt: "2027-01-15T09:00:00.000Z",
  firm: { name: "Skärgårdsmotor AB" },
  customer: {
    name: "Anna Exempelsson",
    type: "private",
    phone: "+46701740605",
    email: "anna@example.se",
    billingAddress: "Båtvägen 1, 134 60 Ingarö",
    language: "sv",
    acquisitionChannel: "web",
    createdAt: new Date("2026-04-02T10:00:00Z"),
  },
  consents: [
    {
      type: "marketing_sms",
      status: "granted",
      recordedAt: new Date("2026-04-02T10:00:00Z"),
      source: "booking",
    },
  ],
  boats: [
    {
      name: "Sjöbris",
      make: "Nimbus",
      model: "320",
      year: 2008,
      lengthM: "9.60",
      registrationNumber: "SE-123",
      role: "owner",
      engines: [
        {
          make: "Volvo Penta",
          model: "D4",
          modelYear: 2008,
          serialNumber: "VP123",
          hours: [{ hours: "1240.0", readAt: new Date("2026-05-01T08:00:00Z") }],
        },
      ],
      placements: [
        {
          season: "summer",
          mode: "water",
          spotId: "B14",
          launchDate: "2026-04-24",
          haulOutDate: "2026-10-16",
        },
      ],
      hasAccessInformation: true,
    },
  ],
  jobs: [
    {
      status: "done",
      description: "Vårservice",
      createdAt: new Date("2026-04-02T10:00:00Z"),
      visits: [
        {
          timeWindow: '["2026-05-01 06:00:00+00","2026-05-01 08:30:00+00")',
          status: "done",
          notes: null,
          report: {
            workDone: "Bytt impeller\nBytt olja",
            recommendations: [{ text: "Byt zinkanoder", priority: "next_season" }],
            nextService: "Höst 2026",
            approvedAt: new Date("2026-05-01T12:00:00Z"),
          },
          survey: { score: 5, comment: "Toppen", answeredAt: new Date("2026-05-02T08:00:00Z") },
        },
      ],
    },
  ],
  messages: [
    {
      at: new Date("2026-05-01T17:00:00Z"),
      channel: "sms",
      direction: "inbound",
      subject: null,
      body: "Tack!",
      status: "received",
    },
    {
      at: new Date("2026-04-02T10:01:00Z"),
      channel: "sms",
      direction: "outbound",
      subject: null,
      body: null,
      status: "delivered",
    },
  ],
  calls: [
    {
      startedAt: new Date("2026-04-02T09:55:00Z"),
      callerNumber: "+46701740605",
      transcript: "Hej, jag vill boka service.",
      summary: "Vill boka vårservice.",
      hasRecording: true,
    },
  ],
};

const texts = (lines: DocumentLine[]) =>
  lines.map((l) => (l.kind === "field" ? `${l.label}: ${l.value}` : l.text));

describe("the export as a document", () => {
  it("says who it is for, from which firm and when", () => {
    const doc = exportDocument(data);
    expect(doc.title).toBe("Registerutdrag för Anna Exempelsson");
    expect(doc.subtitle).toBe("Från Skärgårdsmotor AB, 2027-01-15");
    expect(doc.intro).toContain("Koder och åtkomstinformation");
  });

  it("has every part of the customer's data in Swedish, with Stockholm times", () => {
    const lines = texts(exportDocument(data).lines);
    expect(lines).toEqual(
      expect.arrayContaining([
        "Kunduppgifter",
        "Mobil: 070-174 06 05",
        "Kundtyp: Privatperson",
        "Kom till firman via: bokning på webben",
        "Erbjudanden per sms: lämnat 2026-04-02 (booking)",
        "Sjöbris",
        "Roll: Ägare",
        "Längd: 9,60 m",
        "Motor: Volvo Penta D4 2008",
        "Motortimmar: 1240,0 h (2026-05-01)",
        "Plats: Sommar: i sjön, plats B14, 2026-04-24–2026-10-16",
        "Åtkomstinformation: Finns, men visas inte här.",
        "Status: Utfört",
        "Besök: 2026-05-01 08:00–10:30 (utfört)",
        "Utfört arbete: Bytt impeller\nBytt olja",
        "Rekommendationer: Nästa säsong: Byt zinkanoder",
        "Ditt betyg: 5 av 5: Toppen",
        "Sammanfattning: Vill boka vårservice.",
        "Inspelning: Finns. Begär den av firman om du vill ha den.",
      ]),
    );
    const headings = exportDocument(data)
      .lines.filter((l) => l.kind === "heading")
      .map((l) => (l.kind === "heading" ? l.text : ""));
    expect(headings).toEqual([
      "Kunduppgifter",
      "Samtycken",
      "Båtar",
      "Jobb och besök",
      "Meddelanden",
      "Samtal",
    ]);
  });

  it("puts the messages in time order and says when a body is gone", () => {
    const lines = texts(exportDocument(data).lines);
    const first = lines.indexOf("2026-04-02 12:01, Sms, till kunden (levererad)");
    const second = lines.indexOf("2026-05-01 19:00, Sms, från kunden (mottagen)");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(lines[first + 1]).toBe("(Innehållet är borttaget efter lagringstiden.)");
    expect(lines[second + 1]).toBe("Tack!");
  });

  it("says so when there is nothing in a part", () => {
    const lines = texts(
      exportDocument({ ...data, consents: [], boats: [], jobs: [], messages: [], calls: [] }).lines,
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        "Inga samtycken är registrerade.",
        "Inga båtar är kopplade till dig.",
        "Inga jobb är registrerade.",
        "Inga meddelanden.",
        "Inga samtal.",
      ]),
    );
  });
});

describe("times in the document", () => {
  it("shows a visit's window in Stockholm, and the raw value if it cannot be read", () => {
    expect(formatTimeWindow('["2026-01-10 07:00:00+00","2026-01-10 09:00:00+00")')).toBe(
      "2026-01-10 08:00–10:00",
    );
    expect(formatTimeWindow("[2026-07-01T22:00:00.000Z,2026-07-02T01:00:00.000Z)")).toBe(
      "2026-07-02 00:00–03:00",
    );
    expect(formatTimeWindow('["2026-01-10 22:00:00+00","2026-01-11 01:00:00+00")')).toBe(
      "2026-01-10 23:00–2026-01-11 02:00",
    );
    expect(formatTimeWindow("empty")).toBe("empty");
    expect(stockholmDateTime("2026-07-01T10:05:00Z")).toBe("2026-07-01 12:05");
  });
});
