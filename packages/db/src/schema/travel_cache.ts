import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { location } from "./location";
import { tenant } from "./tenant";

/**
 * Driving times on roads between two places, cached per departure hour (byggplan step 2.2).
 * Crossings by boat or ferry are not stored here; they are added from `location` when read.
 */
export const travelCache = pgTable(
  "travel_cache",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    fromLocationId: uuid("from_location_id").notNull(),
    toLocationId: uuid("to_location_id").notNull(),
    /** Start of the hour the drive leaves in. */
    departureHour: timestamp("departure_hour", { withTimezone: true }).notNull(),
    driveSeconds: integer("drive_seconds").notNull(),
    distanceMeters: integer("distance_meters").notNull(),
    /** `osrm` or `fake`. */
    provider: text("provider").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "travel_cache_from_location_fk",
      columns: [t.tenantId, t.fromLocationId],
      foreignColumns: [location.tenantId, location.id],
    }),
    foreignKey({
      name: "travel_cache_to_location_fk",
      columns: [t.tenantId, t.toLocationId],
      foreignColumns: [location.tenantId, location.id],
    }),
    unique("travel_cache_pair_hour_key").on(
      t.tenantId,
      t.fromLocationId,
      t.toLocationId,
      t.departureHour,
    ),
    check(
      "travel_cache_values_non_negative",
      sql`${t.driveSeconds} >= 0 and ${t.distanceMeters} >= 0`,
    ),
    check("travel_cache_two_places", sql`${t.fromLocationId} <> ${t.toLocationId}`),
    check(
      "travel_cache_whole_hour",
      sql`date_trunc('hour', ${t.departureHour}) = ${t.departureHour}`,
    ),
    tenantIsolationPolicy(),
  ],
);
