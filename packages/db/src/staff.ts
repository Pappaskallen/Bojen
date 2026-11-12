/**
 * Staff and their sign-in accounts (byggplan step 2.7). A staff member is an `app_user`
 * with an e-mail address; the Supabase Auth user is linked through `auth_user_id`.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { appUser } from "./schema";

type Db = Pick<Database, "select" | "update">;

export interface StaffMember {
  id: string;
  tenantId: string;
  authUserId: string | null;
}

/** The staff member with this e-mail, whatever the case, or null. */
export async function findStaffByEmail(db: Db, email: string): Promise<StaffMember | null> {
  const address = email.trim().toLowerCase();
  if (!address.includes("@") || address.length > 254) return null;
  const [row] = await db
    .select({ id: appUser.id, tenantId: appUser.tenantId, authUserId: appUser.authUserId })
    .from(appUser)
    .where(and(sql`lower(${appUser.email}) = ${address}`, isNull(appUser.deletedAt)));
  return row ?? null;
}

/** Links the staff member to their auth user, once. */
export async function linkAuthUser(db: Db, appUserId: string, authUserId: string): Promise<void> {
  await db
    .update(appUser)
    .set({ authUserId })
    .where(and(eq(appUser.id, appUserId), isNull(appUser.authUserId)));
}
