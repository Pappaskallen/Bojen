/**
 * The Fortnox integration (byggplan step 8, spec 11), pure parts: the OAuth 2 request, the
 * customer and the invoice in Fortnox' own format, and what an invoice from Fortnox says about
 * payment. Field names and limits are from Fortnox' OpenAPI description (read 2026-11-23,
 * https://apps.fortnox.se/apidocs) and its authorization guide
 * (https://www.fortnox.se/developer/authorization).
 */
import { createHash, randomBytes } from "node:crypto";
import { addDays } from "../time";
import type { InvoiceLineType } from "../reports/invoice";

export const FORTNOX_AUTHORIZE_URL = "https://apps.fortnox.se/oauth-v1/auth";
export const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
export const FORTNOX_API_URL = "https://api.fortnox.se/3";

/** Customers, articles, invoices, payments and the firm's name. Every scope reads and writes. */
export const FORTNOX_SCOPES = ["customer", "article", "invoice", "payment", "companyinformation"];

/** Fortnox: the access token lasts an hour, the refresh token 45 days and is used once. */
export const ACCESS_TOKEN_SECONDS = 3600;
export const REFRESH_TOKEN_DAYS = 45;
/** Refreshed this long before it runs out, so a call never starts with a dying token. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

/** A PKCE pair (S256, the only method Fortnox takes) and a state against forged callbacks. */
export function newAuthorization(): { state: string; verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(24).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: FORTNOX_SCOPES.join(" "),
    state: input.state,
    access_type: "offline",
    response_type: "code",
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `${FORTNOX_AUTHORIZE_URL}?${query.toString()}`;
}

/** The firm's Fortnox settings, from `tenant.settings.fortnox`. */
export interface FortnoxSettings {
  /** The firm's own article numbers per kind of line; a line without one has no article. */
  articles: Partial<Record<InvoiceLineType, string>>;
  /** Days until the invoice is due; 10 is the norm for private customers (spec A13). */
  dueDays: number;
}

const LINE_TYPES: readonly InvoiceLineType[] = [
  "labour",
  "callout",
  "emergency",
  "discount",
  "part",
];
const ARTICLE_NUMBER = /^[A-Za-z0-9._-]{1,50}$/;

export function fortnoxSettings(
  settings: Record<string, unknown> | null | undefined,
): FortnoxSettings {
  const raw = (settings?.fortnox ?? {}) as {
    articles?: Record<string, unknown>;
    dueDays?: unknown;
  };
  const articles: FortnoxSettings["articles"] = {};
  for (const type of LINE_TYPES) {
    const value = raw.articles?.[type];
    if (typeof value === "string" && ARTICLE_NUMBER.test(value)) articles[type] = value;
  }
  const due = Number(raw.dueDays);
  return { articles, dueDays: Number.isInteger(due) && due >= 0 && due <= 90 ? due : 10 };
}

/** Checks an article number typed in the settings: Fortnox takes up to 50 characters. */
export function isArticleNumber(value: string): boolean {
  return ARTICLE_NUMBER.test(value);
}

/** `Strandvägen 1\n111 22 Stockholm` or `Strandvägen 1, 111 22 Stockholm`. */
export function parseBillingAddress(text: string | null): {
  address1?: string;
  zipCode?: string;
  city?: string;
} {
  if (!text?.trim()) return {};
  const parts = text
    .split(/\r?\n|,/)
    .map((p) => p.trim())
    .filter(Boolean);
  const zipAt = parts.findIndex((p) => /^\d{3}\s?\d{2}\b/.test(p));
  if (zipAt < 0) return { address1: parts.join(", ").slice(0, 1024) };
  const zipLine = parts[zipAt] ?? "";
  const zip = /^(\d{3})\s?(\d{2})\s*(.*)$/.exec(zipLine);
  const street = parts.slice(0, zipAt).join(", ");
  return {
    ...(street ? { address1: street.slice(0, 1024) } : {}),
    ...(zip ? { zipCode: `${zip[1] ?? ""} ${zip[2] ?? ""}` } : {}),
    ...(zip?.[3] ? { city: zip[3].slice(0, 1024) } : {}),
  };
}

export interface FortnoxCustomer {
  CustomerNumber?: string;
  Name: string;
  Type: "PRIVATE" | "COMPANY";
  Email?: string;
  Phone1?: string;
  Address1?: string;
  ZipCode?: string;
  City?: string;
  CountryCode: "SE";
}

export function fortnoxCustomer(customer: {
  name: string;
  type: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: string | null;
}): FortnoxCustomer {
  const address = parseBillingAddress(customer.billingAddress);
  return {
    Name: customer.name.slice(0, 1024),
    Type: customer.type === "private" || customer.type === null ? "PRIVATE" : "COMPANY",
    ...(customer.email ? { Email: customer.email } : {}),
    ...(customer.phone ? { Phone1: customer.phone } : {}),
    ...(address.address1 ? { Address1: address.address1 } : {}),
    ...(address.zipCode ? { ZipCode: address.zipCode } : {}),
    ...(address.city ? { City: address.city } : {}),
    CountryCode: "SE",
  };
}

export interface FortnoxInvoiceRow {
  ArticleNumber?: string;
  Description: string;
  DeliveredQuantity: string;
  /** Kronor, excluding VAT. */
  Price: number;
  VAT: number;
}

export interface FortnoxInvoice {
  CustomerNumber: string;
  InvoiceDate: string;
  DueDate: string;
  VATIncluded: false;
  /** Bojen's own reference: the visit, to find the invoice again and never make it twice. */
  ExternalInvoiceReference1: string;
  YourReference?: string;
  Remarks?: string;
  InvoiceRows: FortnoxInvoiceRow[];
}

/** VAT on boat service is 25 % (reports/invoice.ts). */
const VAT_PERCENT = 25;

/**
 * The approved invoice basis as a Fortnox invoice, excluding VAT, dated the day of the visit
 * and due after the firm's days. A discount is a row with a negative price.
 */
export function fortnoxInvoice(input: {
  customerNumber: string;
  visitId: string;
  /** The visit's day in Stockholm, `YYYY-MM-DD`. */
  day: string;
  lines: readonly {
    type: InvoiceLineType;
    description: string;
    quantity: number;
    unitPriceOre: number;
  }[];
  settings: FortnoxSettings;
  boat?: string | null;
}): FortnoxInvoice {
  return {
    CustomerNumber: input.customerNumber,
    InvoiceDate: input.day,
    DueDate: addDays(input.day, input.settings.dueDays),
    VATIncluded: false,
    ExternalInvoiceReference1: `bojen:${input.visitId}`,
    ...(input.boat ? { YourReference: input.boat.slice(0, 50) } : {}),
    InvoiceRows: input.lines.map((l) => {
      const article = input.settings.articles[l.type];
      return {
        ...(article ? { ArticleNumber: article } : {}),
        Description: l.description.slice(0, 255),
        DeliveredQuantity: String(Math.round(l.quantity * 100) / 100),
        Price: Math.round(l.unitPriceOre) / 100,
        VAT: VAT_PERCENT,
      };
    }),
  };
}

/** What an invoice from Fortnox says: paid when nothing is left to pay. */
export function invoicePayment(invoice: {
  Balance?: number | null;
  Cancelled?: boolean | null;
}): "paid" | "open" | "cancelled" {
  if (invoice.Cancelled) return "cancelled";
  return typeof invoice.Balance === "number" && Math.abs(invoice.Balance) < 0.005 ? "paid" : "open";
}
