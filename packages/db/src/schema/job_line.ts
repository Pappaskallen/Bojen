import { foreignKey, index, integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { jobLineType } from "./enums";
import { job } from "./job";
import { tenant } from "./tenant";

/** A line of work on a job: labour, call-out, emergency surcharge or discount. */
export const jobLine = pgTable(
  "job_line",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    jobId: uuid("job_id").notNull(),
    type: jobLineType("type").notNull(),
    description: text("description").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }),
    /** Unit price in öre excluding VAT. Negative for a discount. */
    unitPriceOre: integer("unit_price_ore").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "job_line_job_fk",
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
    index("job_line_job_id_idx").on(t.tenantId, t.jobId),
    tenantIsolationPolicy(),
  ],
);
