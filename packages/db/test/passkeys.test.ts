import { randomBytes } from "node:crypto";
import { createLocalKms } from "@bojen/adapters";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AccessDeniedError, encryptAccess } from "../src/access";
import { codesForPhone } from "../src/day";
import { addPasskey, passkeyOwner, passkeyUsed, passkeysOf } from "../src/passkeys";
import { appUser, auditLog, staffPasskey } from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback } from "./helpers";

afterAll(closeDb);

/** The helper's visit starts 20 April 2027 06:00Z. */
const START = new Date("2027-04-20T06:00:00Z");
const hours = (n: number) => new Date(START.getTime() + n * 3_600_000);

describe("staff passkeys", () => {
  it("stores the public key and finds its owner by the credential id", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Passfirman", "+46701119301");
      await tx
        .update(appUser)
        .set({ email: "mek@passfirman.test" })
        .where(eq(appUser.id, f.mechanicId));
      await addPasskey(
        tx,
        { tenantId: f.tenantId, appUserId: f.mechanicId },
        {
          credentialId: "cred-ny",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
          prf: true,
          name: "Min telefon",
        },
      );
      const owner = await passkeyOwner(tx, "cred-ny");
      expect(owner).toMatchObject({
        tenantId: f.tenantId,
        appUserId: f.mechanicId,
        email: "mek@passfirman.test",
        passkey: { credentialId: "cred-ny", counter: 0, prf: true, transports: ["internal"] },
      });
      expect(owner?.passkey.publicKey).toEqual(new Uint8Array([1, 2, 3]));
      // The helper's own passkey and the new one.
      expect((await passkeysOf(tx, f.tenantId, f.mechanicId)).map((p) => p.credentialId)).toContain(
        "cred-ny",
      );
      expect(await passkeyOwner(tx, "finns-inte")).toBeNull();
    });
  });

  it("never lets the counter go backwards", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Räknarfirman", "+46701119302");
      const [p] = await tx.select().from(staffPasskey).where(eq(staffPasskey.tenantId, f.tenantId));
      await passkeyUsed(tx, p!.id, 7, START);
      await passkeyUsed(tx, p!.id, 3, START);
      const [after] = await tx.select().from(staffPasskey).where(eq(staffPasskey.id, p!.id));
      expect(after).toMatchObject({ counter: 7, lastUsedAt: START });
    });
  });

  it("does not sign in someone who has left, or who has no e-mail", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Slutatfirman", "+46701119303");
      // The helper's mechanic has no e-mail.
      expect(await passkeyOwner(tx, `cred-${f.tenantId}`)).toBeNull();
      await tx
        .update(appUser)
        .set({ email: "x@slutat.test", deletedAt: START })
        .where(eq(appUser.id, f.mechanicId));
      expect(await passkeyOwner(tx, `cred-${f.tenantId}`)).toBeNull();
    });
  });
});

describe("codes for the phone", () => {
  it("gives the visit's mechanic the codes within 12 hours, to delete 12 hours after the start", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Kodfirman", "+46701119304");
      const deps = { db: tx, kms: createLocalKms(randomBytes(32)), now: () => hours(-10) };
      await encryptAccess(deps, {
        tenantId: f.tenantId,
        boatId: f.boatId,
        code: "4711#",
        keyLocation: "I kapellet",
      });
      const codes = await codesForPhone(deps, f.mechanicId, f.visitId);
      expect(codes).toEqual({
        code: "4711#",
        keyLocation: "I kapellet",
        gateCode: null,
        keyBox: null,
        deleteBy: hours(12),
      });
      // The download is logged like any view.
      const logged = await tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.subjectId, f.visitId)));
      expect(logged.map((l) => l.action)).toContain("access_code_viewed");
    });
  });

  it("keeps them at most 24 hours, and refuses outside the window", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Fönsterfirman", "+46701119305");
      const kms = createLocalKms(randomBytes(32));
      await encryptAccess(
        { db: tx, kms, now: () => START },
        { tenantId: f.tenantId, boatId: f.boatId, code: "1" },
      );
      // The owner, two days before: allowed, but kept for 24 hours only.
      const [owner] = await tx
        .insert(appUser)
        .values({ tenantId: f.tenantId, name: "Ägaren", role: "owner" })
        .returning();
      const early = await codesForPhone(
        { db: tx, kms, now: () => hours(-48) },
        owner!.id,
        f.visitId,
      );
      expect(early.deleteBy).toEqual(hours(-24));
      // The mechanic two days before: outside the window.
      await expect(
        codesForPhone({ db: tx, kms, now: () => hours(-48) }, f.mechanicId, f.visitId),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    });
  });
});
