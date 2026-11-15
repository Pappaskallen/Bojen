import { foreignKey, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { customer } from "./customer";
import { tenant } from "./tenant";

/**
 * One searchable text per customer (byggplan step 5.1, spec C8): the name, phone number and
 * e-mail, and for every boat the customer owns the boat's name, make, model and registration
 * number, its engines' and drives' makes, models and serial numbers, and the marinas where it
 * is placed. A search is then one trigram-indexed `ILIKE` per word on one table, instead of
 * a dozen columns in five tables.
 *
 * Nothing writes to it from the application: database triggers (migration 0020) rebuild a
 * customer's text whenever the customer, a boat, an engine, a drive, a placement or a
 * marina's name changes.
 */
export const customerSearch = pgTable(
  "customer_search",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    document: text("document").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "customer_search_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }).onDelete("cascade"),
    uniqueIndex("customer_search_customer_id_key").on(t.tenantId, t.customerId),
    index("customer_search_document_trgm_idx").using("gin", t.document.op("gin_trgm_ops")),
    tenantIsolationPolicy(),
  ],
);
