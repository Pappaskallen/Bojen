import { sql } from "drizzle-orm";
import { date, foreignKey, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { dateRange } from "./_types";
import { boat } from "./boat";
import { placementMode, placementSeason } from "./enums";
import { location } from "./location";
import { tenant } from "./tenant";

/**
 * Where a boat is during one season.
 *
 * A summer placement runs from launch to haul-out; a winter placement from haul-out
 * to the next launch. A missing date leaves that end open. `valid_during` is derived
 * from the dates, and an exclusion constraint in migration 0002 stops one boat from
 * having two placements for the same day.
 */
export const boatPlacement = pgTable(
  "boat_placement",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    boatId: uuid("boat_id").notNull(),
    locationId: uuid("location_id").notNull(),
    season: placementSeason("season").notNull(),
    mode: placementMode("mode").notNull(),
    /** The berth or spot, for example "B14". */
    spotId: text("spot_id"),
    launchDate: date("launch_date"),
    haulOutDate: date("haul_out_date"),
    validDuring: dateRange("valid_during").generatedAlwaysAs(
      sql`case when season = 'summer' then daterange(launch_date, haul_out_date) else daterange(haul_out_date, launch_date) end`,
    ),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "boat_placement_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    foreignKey({
      name: "boat_placement_location_fk",
      columns: [t.tenantId, t.locationId],
      foreignColumns: [location.tenantId, location.id],
    }),
    index("boat_placement_location_id_idx").on(t.tenantId, t.locationId),
    tenantIsolationPolicy(),
  ],
);
