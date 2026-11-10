import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";
import { currentTenantId } from "./_shared";
import { tenant } from "./tenant";
import { appUser } from "./user";

const ownTenant = sql`"tenant_id" = ${currentTenantId}`;

/**
 * Log of sensitive actions, for example `access_code_viewed` (spec 10.4). Append-only for
 * signed-in users: they can read and add rows in their own tenant, never change or remove
 * them. Rows older than 24 months are removed by a server job (spec 10.3). The log never
 * holds the code or address itself, only which object was touched.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** Empty for actions taken by the system. */
    userId: uuid("user_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    details: jsonb("details").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "audit_log_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    index("audit_log_tenant_id_occurred_at_idx").on(t.tenantId, t.occurredAt),
    index("audit_log_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
    pgPolicy("tenant_read", { for: "select", to: authenticatedRole, using: ownTenant }),
    pgPolicy("tenant_append", { for: "insert", to: authenticatedRole, withCheck: ownTenant }),
  ],
);
