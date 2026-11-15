import {
  bigint,
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, tenantIsolationPolicy } from "./_shared";
import { bytea } from "./_types";
import { tenant } from "./tenant";
import { appUser } from "./user";

/**
 * A staff member's passkey (byggplan step 5.5c, spec 10.7): a sign-in without a code, and the
 * key that unlocks the day view and the codes stored on the phone. Only the public key is
 * kept; the private key never leaves the phone.
 */
export const staffPasskey = pgTable(
  "staff_passkey",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    appUserId: uuid("app_user_id").notNull(),
    /** The credential id, base64url, as the browser gives it. */
    credentialId: text("credential_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    /** The signature counter the authenticator last reported, against cloned keys. */
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array(),
    /** The passkey can give the phone a key for the stored codes (WebAuthn PRF). */
    prf: boolean("prf").notNull().default(false),
    /** What the person called it, for example "Min iPhone". */
    name: text("name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    foreignKey({
      name: "staff_passkey_app_user_fk",
      columns: [t.tenantId, t.appUserId],
      foreignColumns: [appUser.tenantId, appUser.id],
    }),
    uniqueIndex("staff_passkey_credential_id_key").on(t.credentialId),
    index("staff_passkey_app_user_idx").on(t.tenantId, t.appUserId),
    tenantIsolationPolicy(),
  ],
);
