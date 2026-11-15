/**
 * The invoice basis of a visit (byggplan step 5.5d): the firm's price list proposes the lines,
 * the mechanic changes them, and the approved basis goes to Fortnox in step 8. Amounts are in
 * öre excluding VAT; VAT is 25 % on boat service.
 */

import { crm } from "../i18n/sv";

export const VAT_RATE = 0.25;

export type InvoiceLineType = "labour" | "callout" | "emergency" | "discount" | "part";

export interface InvoiceLine {
  type: InvoiceLineType;
  description: string;
  /** Hours for labour, number of parts; 1 for a fixed price. */
  quantity: number;
  /** Excluding VAT. Negative for a discount. */
  unitPriceOre: number;
}

export interface InvoiceTotals {
  lines: (InvoiceLine & { amountOre: number })[];
  netOre: number;
  vatOre: number;
  grossOre: number;
}

/** A line the firm's prices propose, before the mechanic has changed anything. */
export interface ProposedLine {
  type: "labour" | "callout" | "emergency";
  description: string;
  /** Null for a fixed price. */
  hours: number | null;
  unitPriceOre: number;
}

/**
 * The lines the price list gives the visit: the service at its price, the call-out and, on an
 * emergency job, the surcharge. A price the firm has not set gives no line, so nothing is
 * invoiced at a price nobody decided.
 */
export function proposedLines(input: {
  service: { name: string; priceOre: number | null } | null;
  calloutPriceOre: number | null;
  emergencySurchargeOre: number | null;
  urgency: "planned" | "soon" | "emergency";
}): ProposedLine[] {
  const lines: ProposedLine[] = [];
  if (input.service?.priceOre) {
    lines.push({
      type: "labour",
      description: input.service.name,
      hours: null,
      unitPriceOre: input.service.priceOre,
    });
  }
  if (input.calloutPriceOre) {
    lines.push({
      type: "callout",
      description: crm.report.lineType.callout ?? "",
      hours: null,
      unitPriceOre: input.calloutPriceOre,
    });
  }
  if (input.urgency === "emergency" && input.emergencySurchargeOre) {
    lines.push({
      type: "emergency",
      description: crm.report.lineType.emergency ?? "",
      hours: null,
      unitPriceOre: input.emergencySurchargeOre,
    });
  }
  return lines;
}

/** Sums per line and in all, VAT rounded to whole öre on the total. */
export function invoiceTotals(lines: readonly InvoiceLine[]): InvoiceTotals {
  const withAmounts = lines.map((l) => ({
    ...l,
    amountOre: Math.round(l.quantity * l.unitPriceOre),
  }));
  const netOre = withAmounts.reduce((sum, l) => sum + l.amountOre, 0);
  const vatOre = Math.round(netOre * VAT_RATE);
  return { lines: withAmounts, netOre, vatOre, grossOre: netOre + vatOre };
}

/** "1 234,50 kr", as Swedes write amounts. */
export function formatKronor(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE", {
    minimumFractionDigits: ore % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`;
}

/**
 * Kronor typed by a person ("950", "1 234,50", "-200") in öre, or null when it is not an
 * amount. Spaces (also the no-break space Swedish numbers use) and a decimal comma are allowed.
 */
export function parseKronor(text: string): number | null {
  const t = text.replace(/\s/g, "").replace(/kr$/i, "").replace(",", ".");
  if (!/^-?\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
