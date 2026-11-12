import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";
import { visit } from "./visit";

/**
 * The customer's links in sms and e-mail, `bojen.se/x/{code}` (byggplan step 3.4). The code
 * itself is never stored, only a keyed hash of it (`linkHash` in core), so a copy of the
 * database holds no working links. A link expires, and changing or cancelling the booking
 * uses it up.
 */
export const shortLink = pgTable(
  "short_link",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    /** `manage`: see, reschedule or cancel the booking, and add access information. */
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      columns: [t.tenantId, t.visitId],
      foreignColumns: [visit.tenantId, visit.id],
      name: "short_link_visit_fk",
    }),
    uniqueIndex("short_link_code_hash_key").on(t.codeHash),
    index("short_link_visit_idx").on(t.tenantId, t.visitId),
    tenantIsolationPolicy(),
  ],
);
