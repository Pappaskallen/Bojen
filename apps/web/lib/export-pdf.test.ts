import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { drawable, exportPdf, wrap } from "./export-pdf";

const CREATED = new Date("2027-01-15T09:00:00Z");

describe("the export as a pdf", () => {
  it("makes an A4 pdf with the title, and adds pages as needed", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Rad ${String(i)} i utskriften.`).join("\n");
    const bytes = await exportPdf(
      {
        title: "Registerutdrag för Åsa Öberg",
        subtitle: "Från Skärgårdsmotor AB, 2027-01-15",
        intro: "Här är alla personuppgifter.",
        lines: [
          { kind: "heading", text: "Samtal" },
          { kind: "subheading", text: "2026-04-02 11:55" },
          { kind: "field", label: "Utskrift", value: long },
          { kind: "text", text: "Tack för senast 🚤" },
        ],
      },
      CREATED,
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe("Registerutdrag för Åsa Öberg");
    expect(pdf.getProducer()).toBe("Bojen");
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
  });

  it("draws what the font has and puts ? for the rest", () => {
    expect(drawable("Åsa – “Båt” ’s € 🚤\tslut")).toBe("Åsa – “Båt” ’s € ? slut");
  });

  it("wraps text to the width, keeps line breaks and cuts a word too long for a line", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = wrap(`ett två tre\n${"x".repeat(300)}`, font, 10, 100);
    expect(lines[0]).toBe("ett två tre");
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(100);
    expect(lines.slice(1).join("")).toBe("x".repeat(300));
  });
});
