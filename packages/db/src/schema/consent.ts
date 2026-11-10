import { foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { customer } from "./customer";
import { consentStatus, consentType } from "./enums";
import { tenant } from "./tenant";

/**
 * A consent given or withdrawn. Rows are never changed: a new row records each change,
 * and the newest row per customer and type is the one that applies.
 */
export const consent = pgTable(
  "consent",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    type: consentType("type").notNull(),
    status: consentStatus("status").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** Where it was given, for example "booking_page", "call" or "sms_stop". */
    source: text("source").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "consent_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    index("consent_customer_id_type_recorded_at_idx").on(
      t.tenantId,
      t.customerId,
      t.type,
      t.recordedAt,
    ),
    tenantIsolationPolicy(),
  ],
);
