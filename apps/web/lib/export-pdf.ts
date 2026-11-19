/**
 * Draws the customer export (`exportDocument` in `@bojen/core/privacy`) as an A4 pdf
 * (step 7.4, spec 10.3). The standard Helvetica needs no font file and has å, ä and ö; a
 * character it cannot draw (an emoji in an sms, say) becomes a question mark rather than
 * stopping the export.
 */
import { crm } from "@bojen/core/i18n/sv";
import type { DocumentLine, ExportDocument } from "@bojen/core/privacy";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const WIDTH = A4[0] - 2 * MARGIN;
const LABEL_WIDTH = 130;
const GREY = rgb(0.35, 0.35, 0.35);

/** Windows-1252, which the standard fonts are encoded in, beyond Latin-1. */
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Text the standard fonts can draw: one line, unknown characters as `?`. */
export function drawable(text: string): string {
  let out = "";
  for (const ch of text.replace(/\t/g, " ")) {
    const code = ch.codePointAt(0) ?? 0;
    const ok =
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(ch);
    out += ok ? ch : "?";
  }
  return out;
}

/** Splits text into lines no wider than `width`, keeping its own line breaks. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of drawable(paragraph).split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A word wider than the line (a long link) is cut where it has to be.
      let rest = word;
      while (!fits(rest)) {
        let cut = rest.length - 1;
        while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export async function exportPdf(doc: ExportDocument, createdAt: Date): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(drawable(doc.title));
  pdf.setProducer("Bojen");
  pdf.setCreator("Bojen");
  pdf.setCreationDate(createdAt);
  pdf.setModificationDate(createdAt);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const bottom = MARGIN + 20;

  const ensure = (height: number) => {
    if (y - height < bottom) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };
  const write = (
    text: string,
    { font = regular, size = 10, x = MARGIN, width = WIDTH, color = rgb(0, 0, 0), gap = 0 } = {},
  ) => {
    const lead = size * 1.35;
    for (const line of wrap(text, font, size, width)) {
      ensure(lead);
      y -= lead;
      page.drawText(line, { x, y, size, font, color });
    }
    y -= gap;
  };

  write(doc.title, { font: bold, size: 18, gap: 2 });
  write(doc.subtitle, { color: GREY, gap: 8 });
  write(doc.intro, { size: 9, color: GREY, gap: 6 });

  const draw = (line: DocumentLine) => {
    switch (line.kind) {
      case "heading":
        y -= 10;
        ensure(40); // never a heading alone at the foot of a page
        write(line.text, { font: bold, size: 13, gap: 3 });
        break;
      case "subheading":
        y -= 4;
        ensure(30);
        write(line.text, { font: bold, size: 10.5, gap: 1 });
        break;
      case "text":
        write(line.text, { gap: 2 });
        break;
      case "field": {
        const size = 9.5;
        const lead = size * 1.35;
        ensure(lead);
        const top = y;
        page.drawText(drawable(line.label), { x: MARGIN, y: y - lead, size, font: bold });
        y = top;
        write(line.value, { size, x: MARGIN + LABEL_WIDTH, width: WIDTH - LABEL_WIDTH, gap: 1 });
        break;
      }
    }
  };
  doc.lines.forEach(draw);

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const footer = crm.privacy.pdf.page(i + 1, pages.length);
    const size = 8;
    p.drawText(footer, {
      x: A4[0] - MARGIN - regular.widthOfTextAtSize(footer, size),
      y: MARGIN - 10,
      size,
      font: regular,
      color: GREY,
    });
  });

  return pdf.save();
}
