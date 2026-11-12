import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  time,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { timestampRange } from "./_types";
import { tenant } from "./tenant";
import { appUser } from "./user";

/**
 * A mechanic's working hours on one weekday, in Stockholm wall-clock time. A day can
 * have several periods, for example 07–12 and 12:30–17 with lunch in between.
 */
export const workSchedule = pgTable(
  "work_schedule",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "work_schedule_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    check("work_schedule_weekday_range", sql`${t.weekday} between 1 and 7`),
    check("work_schedule_times_ordered", sql`${t.startTime} < ${t.endTime}`),
    index("work_schedule_user_id_idx").on(t.tenantId, t.userId),
    tenantIsolationPolicy(),
  ],
);

/** Time a mechanic cannot be booked: holiday, sick leave, training, the van in service. */
export const scheduleBlock = pgTable(
  "schedule_block",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    during: timestampRange("during").notNull(),
    reason: text("reason"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "schedule_block_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    check(
      "schedule_block_during_bounded",
      sql`not isempty(${t.during}) and not lower_inf(${t.during}) and not upper_inf(${t.during})`,
    ),
    index("schedule_block_during_idx").using("gist", t.tenantId, t.userId, t.during),
    tenantIsolationPolicy(),
  ],
);
