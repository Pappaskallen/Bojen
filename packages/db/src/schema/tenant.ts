import { check, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { bytea } from "./_types";

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
    /** The firm's data key, wrapped by KMS (spec 10.4). Created on first use. */
    dataKeyEncrypted: bytea("data_key_encrypted"),
  },
  (t) => [check("tenant_phone_e164", isE164(t.phone)), tenantIsolationPolicy("id")],
);
