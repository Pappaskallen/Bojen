import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { userRole } from "./enums";
import { tenant } from "./tenant";

/** A person working in a firm. Named app_user because "user" is reserved in Postgres. */
export const appUser = pgTable(
  "app_user",
  {
    ...baseColumns,
    tenantId: uuid("tenant_id").notNull(),
    /** Supabase auth.users.id once the user has signed in. */
    authUserId: uuid("auth_user_id"),
    name: text("name").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    role: userRole("role").notNull(),
    /** Start point of the mechanic's routes. */
    homeAddress: text("home_address"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId], foreignColumns: [tenant.id] }),
    unique("app_user_tenant_id_id_key").on(t.tenantId, t.id),
    uniqueIndex("app_user_auth_user_id_key").on(t.authUserId),
    index("app_user_tenant_id_idx").on(t.tenantId),
    check("app_user_mobile_e164", isE164(t.mobile)),
    tenantIsolationPolicy(),
  ],
);
