import { foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { geographyPolygon } from "./_types";
import { tenant } from "./tenant";

/** A named area the firm works in, for example "Värmdö syd". */
export const area = pgTable(
  "area",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    name: text("name").notNull(),
    boundary: geographyPolygon("boundary").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("area_tenant_id_id_key").on(t.tenantId, t.id),
    index("area_boundary_idx").using("gist", t.boundary),
    tenantIsolationPolicy(),
  ],
);
