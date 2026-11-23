/**
 * The approved invoice bases as a CSV file, for firms without the Fortnox integration (spec
 * 12.1: "export som CSV" until the partner agreement is in place). Made for Swedish Excel and
 * Fortnox' own import: semicolons, decimal commas, a UTF-8 byte order mark and CRLF. One row
 * per invoice line; the basis' totals repeat on each of its rows so the file sorts and filters
 * on its own.
 */
import { crm } from "../i18n/sv";
import type { InvoiceLineType } from "./invoice";

export interface InvoiceExportLine {
  type: InvoiceLineType;
  description: string;
  quantity: number;
  unitPriceOre: number;
  amountOre: number;
}

export interface InvoiceExportRow {
  visitId: string;
  /** The visit's day in Stockholm, `YYYY-MM-DD`. */
  day: string;
  customer: string;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
  boat: string | null;
  service: string | null;
  lines: InvoiceExportLine[];
  netOre: number;
  vatOre: number;
  grossOre: number;
}

const SEPARATOR = ";";
/** Tells Excel the file is UTF-8, so å, ä and ö come out right. */
const BOM = String.fromCharCode(0xfeff);

/** A text cell: quoted when needed, and never read as a formula (CSV injection, ASVS V5.3). */
function text(value: string | null): string {
  let v = (value ?? "").replace(/\r?\n/g, ", ");
  // A phone number in E.164 starts with + but is no formula.
  if (/^[=+\-@\t\r]/.test(v) && !/^\+\d{6,15}$/.test(v)) v = `'${v}`;
  return /[";]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Öre as kronor with a decimal comma and no thousands separator: `-1234,50`. */
export function kronor(ore: number): string {
  const sign = ore < 0 ? "-" : "";
  const abs = Math.abs(Math.round(ore));
  return `${sign}${String(Math.floor(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}

function number(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

export function invoiceCsv(rows: readonly InvoiceExportRow[]): string {
  const h = crm.invoiceExport.columns;
  const header = [
    h.basis,
    h.day,
    h.customer,
    h.email,
    h.phone,
    h.billingAddress,
    h.boat,
    h.service,
    h.type,
    h.description,
    h.quantity,
    h.unitPrice,
    h.amount,
    h.net,
    h.vat,
    h.gross,
  ].map(text);
  const body = [...rows]
    .sort((a, b) => a.day.localeCompare(b.day) || a.visitId.localeCompare(b.visitId))
    .flatMap((r) =>
      r.lines.map((l) =>
        [
          text(r.visitId.slice(0, 8)),
          r.day,
          text(r.customer),
          text(r.email),
          text(r.phone),
          text(r.billingAddress),
          text(r.boat),
          text(r.service),
          text(crm.report.lineType[l.type] ?? l.type),
          text(l.description),
          number(l.quantity),
          kronor(l.unitPriceOre),
          kronor(l.amountOre),
          kronor(r.netOre),
          kronor(r.vatOre),
          kronor(r.grossOre),
        ].join(SEPARATOR),
      ),
    );
  return `${BOM}${[header.join(SEPARATOR), ...body].join("\r\n")}\r\n`;
}

/** `2027-03` → the first day of that month and of the next, or null for anything else. */
export function monthRange(month: string): { first: string; next: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = mon === 12 ? `${String(year + 1)}-01` : `${String(year)}-${pad(mon + 1)}`;
  return { first: `${month}-01`, next: `${next}-01` };
}
