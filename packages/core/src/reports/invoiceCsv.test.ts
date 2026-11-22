import { describe, expect, it } from "vitest";
import { invoiceCsv, kronor, monthRange, type InvoiceExportRow } from "./invoiceCsv";

const row = (over: Partial<InvoiceExportRow> = {}): InvoiceExportRow => ({
  visitId: "0f6b2c1e-1111-4222-8333-444455556666",
  day: "2027-03-14",
  customer: "Per Persson",
  email: "per@example.se",
  phone: "+46701112233",
  billingAddress: "Strandvägen 1\n111 22 Stockholm",
  boat: "Bustern, Nimbus 26",
  service: "Årsservice inombordare",
  lines: [
    {
      type: "labour",
      description: "Årsservice",
      quantity: 2.5,
      unitPriceOre: 95_000,
      amountOre: 237_500,
    },
    {
      type: "discount",
      description: "Marinadag",
      quantity: 1,
      unitPriceOre: -49_500,
      amountOre: -49_500,
    },
  ],
  netOre: 188_000,
  vatOre: 47_000,
  grossOre: 235_000,
  ...over,
});

describe("invoiceCsv", () => {
  it("is one row per line for Swedish Excel: BOM, semicolons, decimal commas, CRLF", () => {
    const csv = invoiceCsv([row()]);
    expect(csv.startsWith("﻿Underlag;Datum;Kund;")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(
      "0f6b2c1e;2027-03-14;Per Persson;per@example.se;+46701112233;Strandvägen 1, 111 22 Stockholm;Bustern, Nimbus 26;Årsservice inombordare;Arbete;Årsservice;2,5;950,00;2375,00;1880,00;470,00;2350,00",
    );
    expect(lines[2]).toContain(";Rabatt;Marinadag;1;-495,00;-495,00;");
    expect(lines[3]).toBe("");
  });

  it("never lets a cell be read as a formula, and quotes semicolons and quotes", () => {
    const csv = invoiceCsv([row({ customer: '=HYPERLINK("x")', boat: "Båt; med semikolon" })]);
    expect(csv).toContain(`;"'=HYPERLINK(""x"")";`);
    expect(csv).toContain(`;"Båt; med semikolon";`);
    expect(invoiceCsv([row({ phone: "+SUM(1)" })])).toContain(";'+SUM(1);");
  });

  it("sorts by day, and an empty month is just the header", () => {
    const csv = invoiceCsv([row({ day: "2027-03-20", customer: "B" }), row({ customer: "A" })]);
    expect(csv.indexOf(";A;")).toBeLessThan(csv.indexOf(";B;"));
    expect(invoiceCsv([]).split("\r\n")).toHaveLength(2);
  });
});

describe("kronor and monthRange", () => {
  it("formats öre", () => {
    expect(kronor(5)).toBe("0,05");
    expect(kronor(-123_450)).toBe("-1234,50");
  });
  it("takes a month and nothing else", () => {
    expect(monthRange("2027-12")).toEqual({ first: "2027-12-01", next: "2028-01-01" });
    expect(monthRange("2027-3")).toBeNull();
    expect(monthRange("2027-13")).toBeNull();
  });
});
