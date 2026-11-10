import { sql } from "drizzle-orm";
import { foreignKey, integer, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";

/** An article, for example an impeller or a fuel filter. */
export const part = pgTable(
  "part",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    articleNumber: text("article_number").notNull(),
    manufacturer: text("manufacturer"),
    description: text("description").notNull(),
    /** Prices in öre excluding VAT. */
    purchasePriceOre: integer("purchase_price_ore"),
    salePriceOre: integer("sale_price_ore"),
    /** Engine models the part fits, for example `{"Volvo Penta D2-40"}`. */
    fitsEngineModels: text("fits_engine_models")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("part_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("part_tenant_id_article_number_key")
      .on(t.tenantId, t.manufacturer, t.articleNumber)
      .where(sql`${t.deletedAt} is null`),
    tenantIsolationPolicy(),
  ],
);
