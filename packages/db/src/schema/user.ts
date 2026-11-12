import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns, isE164, tenantIsolationPolicy } from "./_shared";
import { supabaseAuthAdminRole } from "drizzle-orm/supabase";
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
    // A staff member signs in with their e-mail, so it points to one person in one firm.
    uniqueIndex("app_user_email_key")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null and ${t.deletedAt} is null`),
    // The access-token hook (migration 0012) reads tenant and role for the signed-in user.
    pgPolicy("auth_admin_reads_staff", {
      as: "permissive",
      for: "select",
      to: supabaseAuthAdminRole,
      using: sql`true`,
    }),
    index("app_user_tenant_id_idx").on(t.tenantId),
    check("app_user_mobile_e164", isE164(t.mobile)),
    tenantIsolationPolicy(),
  ],
);
