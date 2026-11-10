import { foreignKey, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { engineType, placementMode } from "./enums";
import { tenant } from "./tenant";

/** A service in the firm's price list, for example "Vårservice inombordare". */
export const serviceType = pgTable(
  "service_type",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    /** The boat must be in this mode, for example on land for bottom work. Empty means any. */
    requiredMode: placementMode("required_mode"),
    engineType: engineType("engine_type"),
    /** Template of standard parts: `[{ partId, quantity }]`. */
    defaultParts: jsonb("default_parts").notNull().default([]),
    /** Price in öre excluding VAT. */
    priceOre: integer("price_ore"),
    /** What the customer should do before the visit, shown in confirmations. */
    preparationText: text("preparation_text"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("service_type_tenant_id_id_key").on(t.tenantId, t.id),
    tenantIsolationPolicy(),
  ],
);
