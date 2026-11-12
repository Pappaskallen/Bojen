import { hashRecoveryCode } from "@bojen/core/crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { appUser, auditLog, tenant } from "../src/schema";
import {
  StaffActionError,
  findStaffByEmail,
  listStaff,
  replaceRecoveryCodes,
  revokeStaffSessions,
  useRecoveryCode,
} from "../src/staff";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

async function firm(tx: Tx) {
  const [t] = await tx.insert(tenant).values({ name: "Säkerhetsfirman" }).returning();
  const tenantId = t!.id;
  const authUserId = crypto.randomUUID();
  // A Supabase Auth user with one signed-in session.
  await tx.execute(
    sql`insert into auth.users (id, email) values (${authUserId}, 'elin@sakerhet.test')`,
  );
  await tx.execute(
    sql`insert into auth.sessions (id, user_id) values (gen_random_uuid(), ${authUserId})`,
  );
  const [owner, elin] = await tx
    .insert(appUser)
    .values([
      { tenantId, name: "Ägaren", role: "owner", email: "agare@sakerhet.test" },
      { tenantId, name: "Elin", role: "mechanic", email: "elin@sakerhet.test", authUserId },
    ])
    .returning();
  return { tenantId, owner: owner!, elin: elin!, authUserId };
}

const sessionsOf = async (tx: Tx, userId: string) =>
  (await tx.execute(sql`select id from auth.sessions where user_id = ${userId}`)).length;

describe("staff security (step 2.8)", () => {
  it("lets the owner end all of a mechanic's sessions and logs it", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      expect(await sessionsOf(tx, f.authUserId)).toBe(1);

      const ended = await revokeStaffSessions(
        tx,
        { tenantId: f.tenantId, appUserId: f.owner.id, role: "owner" },
        f.elin.id,
      );
      expect(ended).toBe(1);
      expect(await sessionsOf(tx, f.authUserId)).toBe(0);
      const logged = await tx
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.action, "staff_sessions_revoked")),
        );
      expect(logged).toMatchObject([
        { userId: f.owner.id, subjectId: f.elin.id, details: { sessions: 1 } },
      ]);
    });
  });

  it("refuses others than the owner, and staff of another firm", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const other = await tx.insert(tenant).values({ name: "Annan" }).returning();
      await expect(
        revokeStaffSessions(
          tx,
          { tenantId: f.tenantId, appUserId: f.elin.id, role: "mechanic" },
          f.owner.id,
        ),
      ).rejects.toThrow(StaffActionError);
      await expect(
        revokeStaffSessions(
          tx,
          { tenantId: other[0]!.id, appUserId: f.owner.id, role: "owner" },
          f.elin.id,
        ),
      ).rejects.toMatchObject({ reason: "not_found" });
      expect(await sessionsOf(tx, f.authUserId)).toBe(1);
    });
  });

  it("uses each recovery code once and only for its owner", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const member = { tenantId: f.tenantId, appUserId: f.elin.id };
      await replaceRecoveryCodes(tx, member, [
        hashRecoveryCode("AAAA-BBBB", f.elin.id),
        hashRecoveryCode("CCCC-DDDD", f.elin.id),
      ]);
      const now = new Date();
      expect(await useRecoveryCode(tx, member, "aaaa bbbb", now)).toBe(true);
      expect(await useRecoveryCode(tx, member, "AAAA-BBBB", now)).toBe(false);
      expect(
        await useRecoveryCode(
          tx,
          { tenantId: f.tenantId, appUserId: f.owner.id },
          "CCCC-DDDD",
          now,
        ),
      ).toBe(false);

      // New codes replace the old ones.
      await replaceRecoveryCodes(tx, member, [hashRecoveryCode("EEEE-FFFF", f.elin.id)]);
      expect(await useRecoveryCode(tx, member, "CCCC-DDDD", now)).toBe(false);
      expect(await useRecoveryCode(tx, member, "EEEE-FFFF", now)).toBe(true);
    });
  });

  it("finds staff by e-mail and lists the firm's staff", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      expect(await findStaffByEmail(tx, "ELIN@sakerhet.test")).toMatchObject({ id: f.elin.id });
      const listed = (await listStaff(tx, f.tenantId)).map((m) => `${m.name}:${m.role}`);
      expect(listed.sort()).toEqual(["Elin:mechanic", "Ägaren:owner"].sort());
    });
  });
});
