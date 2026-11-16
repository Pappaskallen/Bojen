import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { attachment } from "./attachment";
import { boat } from "./boat";
import { engine } from "./engine";
import { tenant } from "./tenant";
import { appUser } from "./user";

/**
 * What the model read on a type plate in a picture (byggplan step 6.3): a suggestion for the
 * boat's engine that the mechanic confirms or dismisses on the boat card. Nothing changes on
 * the engine until it is confirmed.
 */
export const nameplateReading = pgTable(
  "nameplate_reading",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    attachmentId: uuid("attachment_id").notNull(),
    boatId: uuid("boat_id").notNull(),
    make: text("make"),
    model: text("model"),
    serialNumber: text("serial_number"),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
    /** The model that read it, or `fake`. */
    readBy: text("read_by").notNull(),
    status: text("status").notNull().default("suggested"),
    /** The engine the mechanic put it on, once confirmed. */
    engineId: uuid("engine_id"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "nameplate_reading_attachment_fk",
      columns: [t.tenantId, t.attachmentId],
      foreignColumns: [attachment.tenantId, attachment.id],
    }),
    foreignKey({
      name: "nameplate_reading_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    foreignKey({
      name: "nameplate_reading_engine_fk",
      columns: [t.tenantId, t.engineId],
      foreignColumns: [engine.tenantId, engine.id],
    }),
    foreignKey({
      name: "nameplate_reading_decided_by_fk",
      columns: [t.tenantId, t.decidedBy],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    check("nameplate_reading_status", sql`${t.status} in ('suggested', 'confirmed', 'dismissed')`),
    uniqueIndex("nameplate_reading_attachment_key").on(t.tenantId, t.attachmentId),
    index("nameplate_reading_boat_idx").on(t.tenantId, t.boatId),
    tenantIsolationPolicy(),
  ],
);
