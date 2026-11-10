import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { customerType } from "./enums";
import { tenant } from "./tenant";

/** A boat owner, marina, club, rental firm or yard. */
export const customer = pgTable(
  "customer",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    type: customerType("type").notNull().default("private"),
    name: text("name").notNull(),
    /** E.164. Unique per tenant so incoming calls and SMS find the customer quickly. */
    phone: text("phone"),
    email: text("email"),
    billingAddress: text("billing_address"),
    /** How the customer found the firm. */
    acquisitionChannel: text("acquisition_channel"),
    language: text("language").notNull().default("sv"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("customer_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("customer_tenant_id_phone_key")
      .on(t.tenantId, t.phone)
      .where(sql`${t.deletedAt} is null`),
    check("customer_phone_e164", isE164(t.phone)),
    tenantIsolationPolicy(),
  ],
);
