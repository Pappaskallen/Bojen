import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  unique,
  uuid,
  text,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { timestampRange } from "./_types";
import { availabilityStatus, visitStatus } from "./enums";
import { job } from "./job";
import { tenant } from "./tenant";
import { appUser } from "./user";

/**
 * A visit in the calendar. The pipeline follows the job; the calendar follows visits.
 *
 * `time_window` is the planned working time on site, stored in UTC as a half-open
 * `tstzrange`. The window promised to the customer (for example 08–12) is the firm's
 * booking window that contains its start (packages/core/src/scheduling). An exclusion
 * constraint in migration 0003 stops one mechanic from having two visits that overlap,
 * unless one of them is cancelled.
 */
export const visit = pgTable(
  "visit",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    jobId: uuid("job_id").notNull(),
    /** Empty while the visit is not yet assigned to a mechanic. */
    mechanicId: uuid("mechanic_id"),
    timeWindow: timestampRange("time_window").notNull(),
    plannedMinutes: integer("planned_minutes").notNull(),
    status: visitStatus("status").notNull().default("tentative"),
    availabilityStatus: availabilityStatus("availability_status").notNull().default("not_sent"),
    /** What the mechanic wrote on site, for the report draft (step 5.5). */
    notes: text("notes"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "visit_job_fk",
      columns: [t.tenantId, t.jobId],
      foreignColumns: [job.tenantId, job.id],
    }),
    foreignKey({
      name: "visit_mechanic_fk",
      columns: [t.tenantId, t.mechanicId],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    unique("visit_tenant_id_id_key").on(t.tenantId, t.id),
    check(
      "visit_time_window_bounded",
      sql`not isempty(${t.timeWindow}) and not lower_inf(${t.timeWindow}) and not upper_inf(${t.timeWindow})`,
    ),
    check("visit_planned_minutes_positive", sql`${t.plannedMinutes} > 0`),
    index("visit_job_id_idx").on(t.tenantId, t.jobId),
    tenantIsolationPolicy(),
  ],
);
