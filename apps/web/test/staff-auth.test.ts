import { createFakeAuth } from "@bojen/adapters";
import { appUser, connect, tenant, type Database } from "@bojen/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createBookingRoutes } from "../lib/bookings";
import {
  ACCESS_COOKIE,
  createStaffAuthRoutes,
  readCookie,
  staffFromRequest,
} from "../lib/staff-auth";

const connection = connect();
afterAll(() => connection.close());

class Rollback extends Error {}

/** Runs the test against the real database and rolls everything back. */
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

async function firmWithJonas(db: Database) {
  const [t] = await db.insert(tenant).values({ name: "Inloggningsfirman" }).returning();
  const [jonas] = await db
    .insert(appUser)
    .values({ tenantId: t!.id, name: "Jonas", role: "mechanic", email: "Jonas.Ek@Firma.test" })
    .returning();
  return { tenantId: t!.id, jonasId: jonas!.id };
}

const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function setup(db: Database) {
  const auth = createFakeAuth();
  const routes = createStaffAuthRoutes({
    db: () => db,
    auth: () => auth,
    now: () => new Date(),
    secure: true,
  });
  return { auth, routes };
}

describe("staff sign-in", () => {
  it("sends a code to known staff only, and links their auth user", async () => {
    await withRollback(async (db) => {
      const f = await firmWithJonas(db);
      const { auth, routes } = setup(db);

      expect(
        (await routes.code(post("/api/auth/code", { email: "okand@firma.test" }))).status,
      ).toBe(204);
      expect(auth.users.size).toBe(0);

      expect(
        (await routes.code(post("/api/auth/code", { email: "jonas.ek@firma.test" }))).status,
      ).toBe(204);
      expect(auth.codeFor("jonas.ek@firma.test")).toMatch(/^\d{6}$/);
      const [linked] = await db.select().from(appUser).where(eq(appUser.id, f.jonasId));
      expect(linked?.authUserId).toBe(auth.users.get("jonas.ek@firma.test"));
    });
  });

  it("signs in with the right code and sets httpOnly cookies", async () => {
    await withRollback(async (db) => {
      const f = await firmWithJonas(db);
      const { auth, routes } = setup(db);
      await routes.code(post("/api/auth/code", { email: "jonas.ek@firma.test" }));
      const authUserId = auth.users.get("jonas.ek@firma.test")!;
      auth.link(authUserId, { tenantId: f.tenantId, appUserId: f.jonasId, role: "mechanic" });

      expect(
        (
          await routes.verify(
            post("/api/auth/verify", { email: "jonas.ek@firma.test", code: "000000" }),
          )
        ).status,
      ).toBe(401);

      const response = await routes.verify(
        post("/api/auth/verify", {
          email: "jonas.ek@firma.test",
          code: auth.codeFor("jonas.ek@firma.test"),
        }),
      );
      expect(response.status).toBe(204);
      const cookies = response.headers.getSetCookie();
      expect(cookies).toHaveLength(2);
      for (const c of cookies) expect(c).toMatch(/HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);

      // The access cookie now identifies Jonas in his firm.
      const access = readCookie(cookies.map((c) => c.split(";")[0]).join("; "), ACCESS_COOKIE);
      const signedIn = post("/api/bookings", {}, { cookie: `${ACCESS_COOKIE}=${access ?? ""}` });
      expect(await staffFromRequest(auth, signedIn)).toEqual({
        tenantId: f.tenantId,
        actor: { type: "staff", id: f.jonasId },
      });

      // The browser sends Origin on its own POSTs; the same host is fine …
      const sameSite = post(
        "/api/bookings",
        {},
        {
          cookie: `${ACCESS_COOKIE}=${access ?? ""}`,
          origin: "http://127.0.0.1:3100",
          host: "127.0.0.1:3100",
        },
      );
      expect(await staffFromRequest(auth, sameSite)).not.toBeNull();

      // … but a request from another site with the same cookie is refused.
      const forged = post(
        "/api/bookings",
        {},
        {
          cookie: `${ACCESS_COOKIE}=${access ?? ""}`,
          origin: "https://elak.example",
        },
      );
      expect(await staffFromRequest(auth, forged)).toBeNull();

      // After signing out the token is no longer accepted.
      const out = await routes.logout(
        post("/api/auth/logout", undefined, { cookie: `${ACCESS_COOKIE}=${access ?? ""}` }),
      );
      expect(out.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))).toBe(true);
      expect(await staffFromRequest(auth, signedIn)).toBeNull();
    });
  });

  it("answers 401 on the staff routes without sign-in", async () => {
    const auth = createFakeAuth();
    const routes = createBookingRoutes({
      db: () => connection.db,
      now: () => new Date(),
      authorize: (request) => staffFromRequest(auth, request),
    });
    const response = await routes.change(
      post("/api/bookings/00000000-0000-4000-8000-000000000000/approve", undefined, {
        "idempotency-key": "k",
      }),
      "00000000-0000-4000-8000-000000000000",
      "approve",
    );
    expect(response.status).toBe(401);
  });

  it("does not accept a signed-in user who is not staff in any firm", async () => {
    const auth = createFakeAuth();
    const id = await auth.ensureUser("nobody@firma.test");
    await auth.sendCode("nobody@firma.test");
    const session = await auth.verifyCode(
      "nobody@firma.test",
      auth.codeFor("nobody@firma.test") ?? "",
    );
    const request = post(
      "/api/bookings",
      {},
      { cookie: `${ACCESS_COOKIE}=${session?.accessToken ?? ""}` },
    );
    expect(id).toBeTruthy();
    expect(await staffFromRequest(auth, request)).toBeNull();
  });
});
