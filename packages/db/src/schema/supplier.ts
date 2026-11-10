import { check, foreignKey, pgTable, smallint, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";

/** A parts supplier. */
export const supplier = pgTable(
  "supplier",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    defaultLeadTimeDays: smallint("default_lead_time_days"),
    /** How orders are placed, for example "webbshop" or "e-post till order@…". */
    orderingMethod: text("ordering_method"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("supplier_tenant_id_id_key").on(t.tenantId, t.id),
    check("supplier_phone_e164", isE164(t.phone)),
    tenantIsolationPolicy(),
  ],
);
