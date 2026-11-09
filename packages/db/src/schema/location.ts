import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { bytea, geographyPoint } from "./_types";
import { area } from "./area";
import { customer } from "./customer";
import { accessMethod, locationType } from "./enums";
import { tenant } from "./tenant";

/** A place where a boat can be: a marina, club, yard, private dock or the owner's home. */
export const location = pgTable(
  "location",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    type: locationType("type").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    /** Empty until the address has been geocoded. */
    position: geographyPoint("position"),
    accessMethod: accessMethod("access_method").notNull().default("car"),
    /** Time to cross by boat or ferry, one way. */
    crossingMinutes: smallint("crossing_minutes"),
    /** The marina or club that runs the place, when it is a customer. */
    ownerCustomerId: uuid("owner_customer_id"),
    areaId: uuid("area_id"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    // Composite keys keep both ends inside the same tenant. A null id skips the check.
    foreignKey({
      name: "location_owner_customer_fk",
      columns: [t.tenantId, t.ownerCustomerId],
      foreignColumns: [customer.tenantId, customer.id],
    }),
    foreignKey({
      name: "location_area_fk",
      columns: [t.tenantId, t.areaId],
      foreignColumns: [area.tenantId, area.id],
    }),
    unique("location_tenant_id_id_key").on(t.tenantId, t.id),
    index("location_position_idx").using("gist", t.position),
    tenantIsolationPolicy(),
  ],
);

/** General rules for getting into a place: opening hours, gate code, key box, check-in, parking. */
export const locationAccessRule = pgTable(
  "location_access_rule",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    openingHours: jsonb("opening_hours"),
    /** Encrypted with packages/core/src/crypto (step 1.6). */
    gateCodeEncrypted: bytea("gate_code_encrypted"),
    /** Encrypted with packages/core/src/crypto (step 1.6). */
    keyBoxEncrypted: bytea("key_box_encrypted"),
    checkInInstructions: text("check_in_instructions"),
    parking: text("parking"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "location_access_rule_location_fk",
      columns: [t.tenantId, t.locationId],
      foreignColumns: [location.tenantId, location.id],
    }),
    index("location_access_rule_location_id_idx").on(t.tenantId, t.locationId),
    tenantIsolationPolicy(),
  ],
);
