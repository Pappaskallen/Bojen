import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { boat } from "./boat";
import { engineFuel, enginePosition, engineType, hoursSource } from "./enums";
import { tenant } from "./tenant";

/** An engine. A boat can have several. */
export const engine = pgTable(
  "engine",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    boatId: uuid("boat_id").notNull(),
    position: enginePosition("position").notNull().default("single"),
    make: text("make"),
    model: text("model"),
    modelYear: smallint("model_year"),
    type: engineType("type"),
    fuel: engineFuel("fuel"),
    serialNumber: text("serial_number"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "engine_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    unique("engine_tenant_id_id_key").on(t.tenantId, t.id),
    index("engine_boat_id_idx").on(t.tenantId, t.boatId),
    tenantIsolationPolicy(),
  ],
);

/** Drive or gearbox (for example DPH, Bravo III, Alpha One, SX). At most one per engine. */
export const drive = pgTable(
  "drive",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    engineId: uuid("engine_id").notNull(),
    type: text("type"),
    serialNumber: text("serial_number"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "drive_engine_fk",
      columns: [t.tenantId, t.engineId],
      foreignColumns: [engine.tenantId, engine.id],
    }),
    uniqueIndex("drive_engine_id_key")
      .on(t.engineId)
      .where(sql`${t.deletedAt} is null`),
    tenantIsolationPolicy(),
  ],
);

/** A reading of an engine's running hours. */
export const engineHoursReading = pgTable(
  "engine_hours_reading",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    engineId: uuid("engine_id").notNull(),
    hours: numeric("hours", { precision: 8, scale: 1 }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
    source: hoursSource("source").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "engine_hours_reading_engine_fk",
      columns: [t.tenantId, t.engineId],
      foreignColumns: [engine.tenantId, engine.id],
    }),
    index("engine_hours_reading_engine_id_idx").on(t.tenantId, t.engineId, t.readAt),
    tenantIsolationPolicy(),
  ],
);
