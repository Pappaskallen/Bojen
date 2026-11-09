import { sql, type SQL } from "drizzle-orm";
import { type AnyPgColumn, pgPolicy, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

/** The tenant of the signed-in user, taken from the Supabase JWT. */
export const currentTenantId = sql`((select auth.jwt()) ->> 'tenant_id')::uuid`;

/** Primary key and timestamps shared by every table (spec 6.1). */
export const baseColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/** Row Level Security: a signed-in user only reads and writes rows of their own tenant. */
export function tenantIsolationPolicy(column: "tenant_id" | "id" = "tenant_id") {
  const condition = sql`${sql.identifier(column)} = ${currentTenantId}`;
  return pgPolicy("tenant_isolation", {
    as: "permissive",
    for: "all",
    to: authenticatedRole,
    using: condition,
    withCheck: condition,
  });
}

/** Regex for E.164 phone numbers, for example +46701234567. */
export const E164_PATTERN = "^\\+[1-9][0-9]{6,14}$";

/** Check expression: the column is null or holds an E.164 number. */
export function isE164(column: AnyPgColumn): SQL {
  return sql`${column} ~ ${sql.raw(`'${E164_PATTERN}'`)}`;
}
