import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { tenant } from "./tenant";

/**
 * One-time codes sent by sms so an existing customer can book as themselves (step 2.5).
 * Only a hash of the code is stored. A code is valid for a few minutes and a few attempts.
 */
export const verificationCode = pgTable(
  "verification_code",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: smallint("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    check("verification_code_phone_e164", isE164(t.phone)),
    check("verification_code_attempts_range", sql`${t.attempts} >= 0`),
    index("verification_code_phone_idx").on(t.tenantId, t.phone, t.createdAt),
    tenantIsolationPolicy(),
  ],
);
