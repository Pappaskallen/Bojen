import { createHmac } from "node:crypto";
import { createFakeAuth, createFakeSms } from "@bojen/adapters";
import { appUser, connect, message, tenant, type Database } from "@bojen/db";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createStaffAuthRoutes } from "../lib/staff-auth";
import { createWebhookRoutes } from "../lib/webhooks";

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

const MOBILE = "+46701740690";
const KEY = Buffer.from("a-test-only-hook-secret");
const SECRET = `v1,whsec_${KEY.toString("base64")}`;

async function firmWithElin(db: Database, authUserId: string | null = null) {
  const [t] = await db.insert(tenant).values({ name: "Smsfirman" }).returning();
  const [elin] = await db
    .insert(appUser)
    .values({
      tenantId: t!.id,
      name: "Elin",
      role: "mechanic",
      email: "elin@smsfirman.test",
      mobile: MOBILE,
      authUserId,
    })
    .returning();
  return { tenantId: t!.id, elinId: elin!.id };
}

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** What Supabase Auth sends to the sms hook, signed like Standard Webhooks. */
function hookRequest(body: string, now: Date, key = KEY) {
  const id = "msg_test";
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Request("http://localhost/api/webhooks/supabase/send-sms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body,
  });
}

const hookBody = (authUserId: string, otp: string) =>
  JSON.stringify({ user: { id: authUserId, phone: "46701740690" }, sms: { otp } });

function signInRoutes(db: Database) {
  const auth = createFakeAuth();
  const routes = createStaffAuthRoutes({
    db: () => db,
    auth: () => auth,
    now: () => new Date(),
    secure: true,
  });
  return { auth, routes };
}

describe("sign-in with a code by sms", () => {
  it("links the auth user, gives it the number and signs in with the code", async () => {
    await withRollback(async (db) => {
      const f = await firmWithElin(db);
      const { auth, routes } = signInRoutes(db);

      const sent = await routes.code(post("/api/auth/code", { phone: "070-174 06 90" }));
      expect(sent.status).toBe(204);
      const [row] = await db.select().from(appUser).where(eq(appUser.id, f.elinId));
      expect(row?.authUserId).toBeTruthy();
      const code = auth.codeFor(MOBILE);
      expect(code).toMatch(/^\d{6}$/);

      const wrong = await routes.verify(
        post("/api/auth/verify", { phone: MOBILE, code: "000000" }),
      );
      expect(wrong.status).toBe(401);
      const right = await routes.verify(post("/api/auth/verify", { phone: "0701740690", code }));
      expect(right.status).toBe(204);
      expect(right.headers.getSetCookie().join(";")).toContain("bojen_access=");
    });
  });

  it("answers the same for an unknown number and sends nothing", async () => {
    await withRollback(async (db) => {
      await firmWithElin(db);
      const { auth, routes } = signInRoutes(db);
      const unknown = await routes.code(post("/api/auth/code", { phone: "070-174 06 99" }));
      expect(unknown.status).toBe(204);
      expect(auth.codeFor("+46701740699")).toBeUndefined();
      const invalid = await routes.code(post("/api/auth/code", { phone: "inte ett nummer" }));
      expect(invalid.status).toBe(400);
    });
  });
});

describe("the sms hook from Supabase Auth", () => {
  const now = new Date();
  const setup = (db: Database, secret: string | null = SECRET) => {
    const sms = createFakeSms();
    const routes = createWebhookRoutes({
      db: () => db,
      sms: () => sms,
      now: () => now,
      smsHookSecret: () => secret ?? undefined,
      elksToken: () => "elks-token",
    });
    return { sms, routes };
  };

  it("sends the code with 46elks and logs the sms without it", async () => {
    await withRollback(async (db) => {
      const authUserId = crypto.randomUUID();
      const f = await firmWithElin(db, authUserId);
      const { sms, routes } = setup(db);
      const response = await routes.supabaseSendSms(
        hookRequest(hookBody(authUserId, "735102"), now),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(sms.lastTo(MOBILE)).toBe(
        "735102 är din kod för att logga in i Bojen. Den gäller i 10 minuter.",
      );
      const rows = await db.select().from(message).where(eq(message.tenantId, f.tenantId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        template: "staff_sign_in_code",
        status: "sent",
        body: null,
      });
      expect(JSON.stringify(rows)).not.toContain("735102");
    });
  });

  it("refuses a request with a wrong signature, and sends nothing", async () => {
    await withRollback(async (db) => {
      const authUserId = crypto.randomUUID();
      await firmWithElin(db, authUserId);
      const { sms, routes } = setup(db);
      const response = await routes.supabaseSendSms(
        hookRequest(hookBody(authUserId, "735102"), now, Buffer.from("wrong")),
      );
      expect(response.status).toBe(401);
      expect(sms.sent).toHaveLength(0);
    });
  });

  it("refuses when no secret is configured, and for someone who is not staff", async () => {
    await withRollback(async (db) => {
      const body = hookBody(crypto.randomUUID(), "111111");
      const noSecret = await setup(db, null).routes.supabaseSendSms(hookRequest(body, now));
      expect(noSecret.status).toBe(500);
      const notStaff = await setup(db).routes.supabaseSendSms(hookRequest(body, now));
      expect(notStaff.status).toBe(403);
    });
  });
});

describe("delivery reports from 46elks", () => {
  it("need the secret token, and mark the sms delivered", async () => {
    await withRollback(async (db) => {
      const [t] = await db.insert(tenant).values({ name: "Leveransfirman" }).returning();
      const [m] = await db
        .insert(message)
        .values({
          tenantId: t!.id,
          channel: "sms",
          direction: "outbound",
          status: "sent",
          externalId: "s-abc",
          toAddress: MOBILE,
        })
        .returning();
      const routes = createWebhookRoutes({
        db: () => db,
        sms: () => createFakeSms(),
        now: () => new Date(),
        smsHookSecret: () => SECRET,
        elksToken: () => "elks-token",
      });
      const report = (token: string) =>
        new Request(`http://localhost/api/webhooks/elks/delivery?token=${token}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            id: "s-abc",
            status: "delivered",
            delivered: "2026-11-12T09:15:02.123000",
          }).toString(),
        });
      expect((await routes.elksDelivery(report("wrong"))).status).toBe(401);
      const [untouched] = await db.select().from(message).where(eq(message.id, m!.id));
      expect(untouched?.status).toBe("sent");
      expect((await routes.elksDelivery(report("elks-token"))).status).toBe(200);
      const [row] = await db.select().from(message).where(eq(message.id, m!.id));
      expect(row).toMatchObject({
        status: "delivered",
        deliveredAt: new Date("2026-11-12T09:15:02.123Z"),
      });
    });
  });
});
