import { check, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";

/** A mechanic firm. Every other table belongs to exactly one tenant. */
export const tenant = pgTable(
  "tenant",
  {
    ...baseColumns,
    name: text("name").notNull(),
    orgNumber: text("org_number"),
    vatNumber: text("vat_number"),
    /** The firm's public number (46elks), E.164. */
    phone: text("phone"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [check("tenant_phone_e164", isE164(t.phone)), tenantIsolationPolicy("id")],
);
