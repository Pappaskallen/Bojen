import {
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { customer } from "./customer";
import { boatStatus, ownershipRole } from "./enums";
import { tenant } from "./tenant";

/** The boat is the centre of the CRM. */
export const boat = pgTable(
  "boat",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name"),
    make: text("make"),
    model: text("model"),
    lengthM: numeric("length_m", { precision: 5, scale: 2 }),
    year: smallint("year"),
    hullType: text("hull_type"),
    /** Registration or SXK number. */
    registrationNumber: text("registration_number"),
    status: boatStatus("status").notNull().default("active"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("boat_tenant_id_id_key").on(t.tenantId, t.id),
    tenantIsolationPolicy(),
  ],
);

/** Customer–boat link (N:M): owners, co-owners and contacts over time. */
export const boatOwnership = pgTable(
  "boat_ownership",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    boatId: uuid("boat_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    role: ownershipRole("role").notNull().default("owner"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    // Composite keys keep both ends inside the same tenant.
    foreignKey({
      name: "boat_ownership_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    foreignKey({
      name: "boat_ownership_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    index("boat_ownership_boat_id_idx").on(t.tenantId, t.boatId),
    index("boat_ownership_customer_id_idx").on(t.tenantId, t.customerId),
    tenantIsolationPolicy(),
  ],
);
