import { foreignKey, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { bytea } from "./_types";
import { tenant } from "./tenant";
import { appUser } from "./user";

/**
 * A firm's connection to Fortnox (byggplan step 8). The tokens are encrypted with the firm's
 * data key (`fortnox_connection.access_token` and `.refresh_token` in the AAD) and never
 * logged. The refresh token is used once: every refresh stores the new pair. `needs_reconnect`
 * is set when Fortnox no longer takes the refresh token; the owner then connects again.
 */
export const fortnoxConnection = pgTable(
  "fortnox_connection",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    accessTokenEncrypted: bytea("access_token_encrypted").notNull(),
    refreshTokenEncrypted: bytea("refresh_token_encrypted").notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }).notNull(),
    scope: text("scope").notNull(),
    /** The firm's name in Fortnox, shown so the owner sees which company is connected. */
    companyName: text("company_name"),
    connectedBy: uuid("connected_by"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    needsReconnectAt: timestamp("needs_reconnect_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "fortnox_connection_connected_by_fk",
      columns: [t.tenantId, t.connectedBy],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    uniqueIndex("fortnox_connection_tenant_key").on(t.tenantId),
    tenantIsolationPolicy(),
  ],
);
