import { date, foreignKey, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";

/**
 * A daily snapshot of a KPI, so that a figure can be compared with the same date last
 * year (KPI 15). Written by a worker job (step 7.x).
 */
export const kpiSnapshot = pgTable(
  "kpi_snapshot",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    snapshotDate: date("snapshot_date").notNull(),
    /** KPI key, for example `kpi14_prebooking_spring`. */
    kpi: text("kpi").notNull(),
    value: numeric("value", { precision: 14, scale: 4 }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    uniqueIndex("kpi_snapshot_tenant_id_kpi_snapshot_date_key").on(
      t.tenantId,
      t.kpi,
      t.snapshotDate,
    ),
    tenantIsolationPolicy(),
  ],
);
