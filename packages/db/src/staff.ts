/**
 * Staff and their sign-in accounts (byggplan step 2.7). A staff member is an `app_user`
 * with an e-mail address; the Supabase Auth user is linked through `auth_user_id`.
 */
import { recoveryCodeMatches } from "@bojen/core/crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { appUser, auditLog, mfaRecoveryCode } from "./schema";

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

export interface StaffByMobile extends StaffMember {
  email: string | null;
}

/** The staff member with this mobile number (E.164), or null (step 3.1). */
export async function findStaffByMobile(db: Db, mobile: string): Promise<StaffByMobile | null> {
  const [row] = await db
    .select({
      id: appUser.id,
      tenantId: appUser.tenantId,
      authUserId: appUser.authUserId,
      email: appUser.email,
    })
    .from(appUser)
    .where(and(eq(appUser.mobile, mobile), isNull(appUser.deletedAt)));
  return row ?? null;
}

/** The firm of a signed-in auth user, for the sms hook; null if not staff. */
export async function staffByAuthUser(
  db: Db,
  authUserId: string,
): Promise<{ id: string; tenantId: string } | null> {
  const [row] = await db
    .select({ id: appUser.id, tenantId: appUser.tenantId })
    .from(appUser)
    .where(and(eq(appUser.authUserId, authUserId), isNull(appUser.deletedAt)));
  return row ?? null;
}

/** Links the staff member to their auth user, once. */
export async function linkAuthUser(db: Db, appUserId: string, authUserId: string): Promise<void> {
  await db
    .update(appUser)
    .set({ authUserId })
    .where(and(eq(appUser.id, appUserId), isNull(appUser.authUserId)));
}

// --- Second factor and sessions (byggplan step 2.8) --------------------------------------

/** Replaces the staff member's recovery codes with new ones (only hashes are stored). */
export async function replaceRecoveryCodes(
  db: Pick<Database, "transaction">,
  member: { tenantId: string; appUserId: string },
  codeHashes: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(mfaRecoveryCode)
      .where(
        and(
          eq(mfaRecoveryCode.tenantId, member.tenantId),
          eq(mfaRecoveryCode.appUserId, member.appUserId),
        ),
      );
    if (codeHashes.length > 0) {
      await tx
        .insert(mfaRecoveryCode)
        .values(codeHashes.map((codeHash) => ({ ...member, codeHash })));
    }
  });
}

/** Uses up a recovery code. True when it matched an unused code of this staff member. */
export async function useRecoveryCode(
  db: Pick<Database, "transaction">,
  member: { tenantId: string; appUserId: string },
  code: string,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const unused = await tx
      .select({ id: mfaRecoveryCode.id, codeHash: mfaRecoveryCode.codeHash })
      .from(mfaRecoveryCode)
      .where(
        and(
          eq(mfaRecoveryCode.tenantId, member.tenantId),
          eq(mfaRecoveryCode.appUserId, member.appUserId),
          isNull(mfaRecoveryCode.usedAt),
        ),
      )
      .for("update");
    const match = unused.find((c) => recoveryCodeMatches(code, member.appUserId, c.codeHash));
    if (!match) return false;
    await tx.update(mfaRecoveryCode).set({ usedAt: now }).where(eq(mfaRecoveryCode.id, match.id));
    return true;
  });
}

export interface StaffListing {
  id: string;
  name: string;
  email: string | null;
  role: "owner" | "admin" | "mechanic";
  authUserId: string | null;
}

/** The firm's staff, for the security page. */
export async function listStaff(
  db: Pick<Database, "select">,
  tenantId: string,
): Promise<StaffListing[]> {
  return db
    .select({
      id: appUser.id,
      name: appUser.name,
      email: appUser.email,
      role: appUser.role,
      authUserId: appUser.authUserId,
    })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), isNull(appUser.deletedAt)))
    .orderBy(appUser.name);
}

export class StaffActionError extends Error {
  constructor(readonly reason: "not_found" | "forbidden") {
    super(`Staff action refused: ${reason}`);
    this.name = "StaffActionError";
  }
}

/**
 * Ends every session of a staff member at once, for example when a phone is lost (spec 10.4).
 * Deleting the rows in `auth.sessions` makes Supabase Auth refuse both the access token and
 * the refresh token. Only the owner may do it, and it is written to `audit_log`.
 */
export async function revokeStaffSessions(
  db: Pick<Database, "transaction">,
  actor: { tenantId: string; appUserId: string; role: string },
  targetId: string,
): Promise<number> {
  if (actor.role !== "owner") throw new StaffActionError("forbidden");
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ authUserId: appUser.authUserId })
      .from(appUser)
      .where(and(eq(appUser.tenantId, actor.tenantId), eq(appUser.id, targetId)));
    if (!target) throw new StaffActionError("not_found");
    const deleted = target.authUserId
      ? await tx.execute(
          sql`delete from auth.sessions where user_id = ${target.authUserId} returning id`,
        )
      : [];
    await tx.insert(auditLog).values({
      tenantId: actor.tenantId,
      userId: actor.appUserId,
      action: "staff_sessions_revoked",
      subjectType: "app_user",
      subjectId: targetId,
      details: { sessions: deleted.length },
    });
    return deleted.length;
  });
}

/** Records that the owner reset someone's second factor; the reset itself is in Auth. */
export async function recordSecondFactorReset(
  db: Pick<Database, "insert">,
  actor: { tenantId: string; appUserId: string },
  targetId: string,
  reason: "owner_reset" | "recovery_code",
): Promise<void> {
  await db.insert(auditLog).values({
    tenantId: actor.tenantId,
    userId: actor.appUserId,
    action: "staff_second_factor_reset",
    subjectType: "app_user",
    subjectId: targetId,
    details: { reason },
  });
}
