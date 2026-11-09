import { sql } from "drizzle-orm";
import { check, date, foreignKey, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { bytea } from "./_types";
import { boat } from "./boat";
import { tenant } from "./tenant";

/**
 * How to get onto one boat. The key location and code are access information and are
 * only stored encrypted (packages/core/src/crypto, step 1.6). They are never logged and
 * no voice-agent tool may return them.
 */
export const accessInfo = pgTable(
  "access_info",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    boatId: uuid("boat_id").notNull(),
    keyLocationEncrypted: bytea("key_location_encrypted"),
    codeEncrypted: bytea("code_encrypted"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    validUntil: date("valid_until"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "access_info_boat_fk",
      columns: [t.tenantId, t.boatId],
      foreignColumns: [boat.tenantId, boat.id],
    }),
    // A boat has at most one current access record.
    uniqueIndex("access_info_boat_id_key")
      .on(t.boatId)
      .where(sql`${t.deletedAt} is null`),
    check("access_info_contact_phone_e164", isE164(t.contactPhone)),
    tenantIsolationPolicy(),
  ],
);
