import { createFakeAuth, type FakeAuth } from "@bojen/adapters";
import { appUser, auditLog, connect, tenant, type Database } from "@bojen/db";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createStaffAdminRoutes } from "../lib/staff-admin";
import {
  ACCESS_COOKIE,
  createStaffAuthRoutes,
  readCookie,
  staffFromRequest,
} from "../lib/staff-auth";

const connection = connect();
afterAll(() => connection.close());

class Rollback extends Error {}

async function withRollback(fn: (db: Database) => Promise<void>) {
  try {
    await connection.db.transaction(async (tx) => {
      await fn(tx as unknown as Database);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const post = (path: string, body?: unknown, cookie?: string) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** The Cookie header a browser would send after these Set-Cookie headers. */
const cookieFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function setup(db: Database) {
  const [t] = await db.insert(tenant).values({ name: "Tvåfaktorsfirman" }).returning();
  const tenantId = t!.id;
  const [owner, elin] = await db
    .insert(appUser)
    .values([
      { tenantId, name: "Ägaren", role: "owner", email: "agare@tva.test" },
      { tenantId, name: "Elin", role: "mechanic", email: "elin@tva.test" },
    ])
    .returning();
  const auth = createFakeAuth();
  const routes = createStaffAuthRoutes({
    db: () => db,
    auth: () => auth,
    now: () => new Date(),
    secure: false,
  });
  const admin = createStaffAdminRoutes({ db: () => db, auth: () => auth });

  /** Signs in with the e-mail code and returns the browser's cookie header. */
  async function signIn(
    email: string,
    member: { id: string; role: "owner" | "admin" | "mechanic" },
  ) {
    await routes.code(post("/api/auth/code", { email }));
    const authUserId = auth.users.get(email)!;
    auth.link(authUserId, { tenantId, appUserId: member.id, role: member.role });
    const response = await routes.verify(
      post("/api/auth/verify", { email, code: auth.codeFor(email) }),
    );
    expect(response.status).toBe(204);
    return cookieFrom(response);
  }
  return { tenantId, owner: owner!, elin: elin!, auth, routes, admin, signIn };
}

const staffWith = (auth: FakeAuth, cookie: string) =>
  staffFromRequest(auth, post("/api/bookings", {}, cookie));

describe("second factor for owners (step 2.8)", () => {
  it("keeps an owner out until an authenticator app is added, then lets them in", async () => {
    await withRollback(async (db) => {
      const f = await setup(db);
      const cookie = await f.signIn("agare@tva.test", f.owner);
      expect(await staffWith(f.auth, cookie)).toBeNull();

      const enroll = await f.routes.mfaEnroll(post("/api/auth/mfa-enroll", undefined, cookie));
      const { factorId } = (await enroll.json()) as { factorId: string };
      expect(
        (
          await f.routes.mfaVerify(
            post("/api/auth/mfa-verify", { factorId, code: "000000" }, cookie),
          )
        ).status,
      ).toBe(401);

      const verified = await f.routes.mfaVerify(
        post("/api/auth/mfa-verify", { factorId, code: f.auth.totpFor(factorId) }, cookie),
      );
      expect(verified.status).toBe(200);
      const { recoveryCodes } = (await verified.json()) as { recoveryCodes: string[] };
      expect(recoveryCodes).toHaveLength(10);
      expect(await staffWith(f.auth, cookieFrom(verified))).toEqual({
        tenantId: f.tenantId,
        actor: { type: "staff", id: f.owner.id },
      });
    });
  });

  it("asks for the app code at the next sign-in, and a recovery code replaces a lost phone", async () => {
    await withRollback(async (db) => {
      const f = await setup(db);
      let cookie = await f.signIn("agare@tva.test", f.owner);
      const { factorId } = (await (
        await f.routes.mfaEnroll(post("/api/auth/mfa-enroll", undefined, cookie))
      ).json()) as {
        factorId: string;
      };
      const first = await f.routes.mfaVerify(
        post("/api/auth/mfa-verify", { factorId, code: f.auth.totpFor(factorId) }, cookie),
      );
      const { recoveryCodes } = (await first.json()) as { recoveryCodes: string[] };

      // Next day: the e-mail code alone is not enough.
      cookie = await f.signIn("agare@tva.test", f.owner);
      expect(await staffWith(f.auth, cookie)).toBeNull();
      // Adding another app is not allowed before the existing one has been used.
      expect(
        (await f.routes.mfaEnroll(post("/api/auth/mfa-enroll", undefined, cookie))).status,
      ).toBe(401);
      const challenged = await f.routes.mfaChallenge(
        post("/api/auth/mfa-challenge", { code: f.auth.totpFor(factorId) }, cookie),
      );
      expect(challenged.status).toBe(204);
      expect(await staffWith(f.auth, cookieFrom(challenged))).not.toBeNull();

      // The phone is lost: a recovery code removes the app but does not open the pages.
      cookie = await f.signIn("agare@tva.test", f.owner);
      expect(
        (await f.routes.recover(post("/api/auth/recover", { code: "XXXX-XXXX" }, cookie))).status,
      ).toBe(401);
      expect(
        (await f.routes.recover(post("/api/auth/recover", { code: recoveryCodes[0] }, cookie)))
          .status,
      ).toBe(204);
      expect(
        (await f.routes.recover(post("/api/auth/recover", { code: recoveryCodes[0] }, cookie)))
          .status,
      ).toBe(401);
      expect(await f.auth.hasFactor(f.auth.users.get("agare@tva.test")!)).toBe(false);
      expect(await staffWith(f.auth, cookie)).toBeNull();
      const logged = await db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.action, "staff_second_factor_reset")),
        );
      expect(logged).toMatchObject([
        { subjectId: f.owner.id, details: { reason: "recovery_code" } },
      ]);
    });
  });

  it("lets a mechanic in without an app, but not past one they have added", async () => {
    await withRollback(async (db) => {
      const f = await setup(db);
      let cookie = await f.signIn("elin@tva.test", { id: f.elin.id, role: "mechanic" });
      expect(await staffWith(f.auth, cookie)).not.toBeNull();

      const { factorId } = (await (
        await f.routes.mfaEnroll(post("/api/auth/mfa-enroll", undefined, cookie))
      ).json()) as {
        factorId: string;
      };
      await f.routes.mfaVerify(
        post("/api/auth/mfa-verify", { factorId, code: f.auth.totpFor(factorId) }, cookie),
      );
      cookie = await f.signIn("elin@tva.test", { id: f.elin.id, role: "mechanic" });
      expect(await staffWith(f.auth, cookie)).toBeNull();
    });
  });
});

describe("the owner's tools (step 2.8)", () => {
  async function completeOwner(f: Awaited<ReturnType<typeof setup>>) {
    const cookie = await f.signIn("agare@tva.test", f.owner);
    const { factorId } = (await (
      await f.routes.mfaEnroll(post("/api/auth/mfa-enroll", undefined, cookie))
    ).json()) as {
      factorId: string;
    };
    return cookieFrom(
      await f.routes.mfaVerify(
        post("/api/auth/mfa-verify", { factorId, code: f.auth.totpFor(factorId) }, cookie),
      ),
    );
  }

  it("lets only an owner with a complete session block a mechanic and reset their app", async () => {
    await withRollback(async (db) => {
      const f = await setup(db);
      const elinCookie = await f.signIn("elin@tva.test", { id: f.elin.id, role: "mechanic" });
      const ownerAal1 = await f.signIn("agare@tva.test", f.owner);

      expect(
        (
          await f.admin.revoke(
            post(`/api/staff/${f.owner.id}/revoke`, undefined, elinCookie),
            f.owner.id,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await f.admin.revoke(
            post(`/api/staff/${f.elin.id}/revoke`, undefined, ownerAal1),
            f.elin.id,
          )
        ).status,
      ).toBe(401);

      const owner = await completeOwner(f);
      expect(
        (await f.admin.revoke(post(`/api/staff/${f.elin.id}/revoke`, undefined, owner), f.elin.id))
          .status,
      ).toBe(204);
      expect(
        (
          await f.admin.resetFactor(
            post(`/api/staff/${f.elin.id}/reset-factor`, undefined, owner),
            f.elin.id,
          )
        ).status,
      ).toBe(204);
      const actions = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.subjectId, f.elin.id)));
      expect(actions.map((a) => a.action).sort()).toEqual([
        "staff_second_factor_reset",
        "staff_sessions_revoked",
      ]);
      expect(readCookie(owner, ACCESS_COOKIE)).toBeTruthy();
    });
  });
});
