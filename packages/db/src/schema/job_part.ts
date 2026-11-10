import { sql } from "drizzle-orm";
import { check, foreignKey, index, numeric, pgTable, smallint, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { jobPartSource, jobPartStatus } from "./enums";
import { job } from "./job";
import { part } from "./part";
import { supplier } from "./supplier";
import { tenant } from "./tenant";

/** A part used on a job, from the van or ordered from a supplier. */
export const jobPart = pgTable(
  "job_part",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    jobId: uuid("job_id").notNull(),
    partId: uuid("part_id").notNull(),
    quantity: numeric("quantity", { precision: 8, scale: 2 }).notNull().default("1"),
    status: jobPartStatus("status").notNull().default("needed"),
    supplierId: uuid("supplier_id"),
    leadTimeDays: smallint("lead_time_days"),
    source: jobPartSource("source").notNull().default("order"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "job_part_job_fk",
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
    foreignKey({
      name: "job_part_part_fk",
      columns: [t.tenantId, t.partId],
      foreignColumns: [part.tenantId, part.id],
    }),
    foreignKey({
      name: "job_part_supplier_fk",
      columns: [t.tenantId, t.supplierId],
      foreignColumns: [supplier.tenantId, supplier.id],
    }),
    check("job_part_quantity_positive", sql`${t.quantity} > 0`),
    index("job_part_job_id_idx").on(t.tenantId, t.jobId),
    tenantIsolationPolicy(),
  ],
);
