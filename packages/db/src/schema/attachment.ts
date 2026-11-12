import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";

/**
 * A picture or file that belongs to a boat, job, visit or call (spec 6.1). The file lives
 * in object storage under `storage_key`; the key starts with the tenant id.
 */
export const attachment = pgTable(
  "attachment",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    /** `boat`, `job`, `visit` or `call`. */
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    check("attachment_owner_type", sql`${t.ownerType} in ('boat', 'job', 'visit', 'call')`),
    check("attachment_size_positive", sql`${t.sizeBytes} > 0`),
    check(
      "attachment_key_in_tenant",
      sql`starts_with(${t.storageKey}, ${t.tenantId}::text || '/')`,
    ),
    unique("attachment_storage_key_key").on(t.storageKey),
    index("attachment_owner_idx").on(t.tenantId, t.ownerType, t.ownerId),
    tenantIsolationPolicy(),
  ],
);
