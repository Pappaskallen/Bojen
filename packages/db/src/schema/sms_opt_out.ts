import { foreignKey, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";

/**
 * Numbers that replied STOPP to a firm (byggplan step 3.1, spec 10.4). Kept permanently,
 * and only as a keyed hash (`optOutHash` in core), so the list itself holds no numbers.
 */
export const smsOptOut = pgTable(
  "sms_opt_out",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    phoneHash: text("phone_hash").notNull(),
    /** Where it came from, for example "sms_stop" or "staff". */
    source: text("source").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    uniqueIndex("sms_opt_out_tenant_id_phone_hash_key").on(t.tenantId, t.phoneHash),
    tenantIsolationPolicy(),
  ],
);
