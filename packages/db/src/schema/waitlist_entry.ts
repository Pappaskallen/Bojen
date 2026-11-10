import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, pgTable, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { area } from "./area";
import { boat } from "./boat";
import { customer } from "./customer";
import { waitlistStatus } from "./enums";
import { serviceType } from "./service_type";
import { tenant } from "./tenant";

/** A customer who wants an earlier time if one is freed (flow F4). */
export const waitlistEntry = pgTable(
  "waitlist_entry",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    boatId: uuid("boat_id"),
    areaId: uuid("area_id"),
    serviceTypeId: uuid("service_type_id"),
    earliestDate: date("earliest_date"),
    latestDate: date("latest_date"),
    status: waitlistStatus("status").notNull().default("waiting"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "waitlist_entry_customer_fk",
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    foreignKey({
      name: "waitlist_entry_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    foreignKey({
      name: "waitlist_entry_area_fk",
      columns: [t.tenantId, t.areaId],
      foreignColumns: [area.tenantId, area.id],
    }),
    foreignKey({
      name: "waitlist_entry_service_type_fk",
      columns: [t.tenantId, t.serviceTypeId],
      foreignColumns: [serviceType.tenantId, serviceType.id],
    }),
    check(
      "waitlist_entry_dates_ordered",
      sql`${t.earliestDate} is null or ${t.latestDate} is null or ${t.earliestDate} <= ${t.latestDate}`,
    ),
    index("waitlist_entry_tenant_id_status_idx").on(t.tenantId, t.status),
    tenantIsolationPolicy(),
  ],
);
