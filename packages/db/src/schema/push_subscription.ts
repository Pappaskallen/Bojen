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
import { appUser } from "./user";

/**
 * A staff member's phone or computer that takes web push (byggplan step 6.4): messages from
 * the receptionist and urgent calls. The keys are the browser's public ones for encrypting
 * the push, not secrets of the firm. A subscription the push service says is gone is deleted.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "push_subscription_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
    }).onDelete("cascade"),
    uniqueIndex("push_subscription_endpoint_key").on(t.endpoint),
    index("push_subscription_user_idx").on(t.tenantId, t.userId),
    tenantIsolationPolicy(),
  ],
);
