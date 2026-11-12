import { createFakeClassifier, createFakeSms } from "@bojen/adapters";
import { connect, customer, message, tenant, type Database } from "@bojen/db";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ELKS_IPS, createWebhookRoutes } from "../lib/webhooks";

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

const FIRM_NUMBER = "+46766860002";
const PHONE = "+46701112255";
const TOKEN = "elks-test-token-long-enough-1234567890";

function routes(db: Database, ips: readonly string[] | null = ELKS_IPS) {
  return createWebhookRoutes({
    db: () => db,
    sms: () => createFakeSms(),
    now: () => new Date(),
    smsHookSecret: () => undefined,
    elksToken: () => TOKEN,
    elksIps: () => ips,
    classifier: () => createFakeClassifier(),
    optOutKey: () => "test-opt-out-key",
  });
}

/** What 46elks posts for an incoming sms (https://46elks.com/docs/receive-sms). */
function incoming(token: string, ip: string | null, text = "STOPP") {
  return new Request(`https://app.bojen.test/api/webhooks/elks/sms?token=${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(ip ? { "x-real-ip": ip } : {}),
    },
    body: new URLSearchParams({
      direction: "incoming",
      id: `s${crypto.randomUUID()}`,
      from: PHONE,
      to: FIRM_NUMBER,
      message: text,
      created: "2026-11-12 10:00:00.000000",
    }).toString(),
  });
}

async function firm(db: Database) {
  const [t] = await db
    .insert(tenant)
    .values({ name: "Webhookfirman", settings: { sms: { from: FIRM_NUMBER } } })
    .returning();
  await db.insert(customer).values({ tenantId: t!.id, name: "Per", phone: PHONE });
  return t!.id;
}

const inbound = (db: Database, tenantId: string) =>
  db
    .select()
    .from(message)
    .where(and(eq(message.tenantId, tenantId), eq(message.direction, "inbound")));

describe("incoming sms from 46elks", () => {
  it("needs the secret token: 46elks has no signature, so the URL carries one", async () => {
    await withRollback(async (db) => {
      const tenantId = await firm(db);
      const wrong = await routes(db).elksSms(incoming("wrong-token", ELKS_IPS[0]));
      expect(wrong.status).toBe(401);
      expect(await inbound(db, tenantId)).toHaveLength(0);
    });
  });

  it("in production only 46elks' own addresses are let in, also with the right token", async () => {
    await withRollback(async (db) => {
      const tenantId = await firm(db);
      expect((await routes(db).elksSms(incoming(TOKEN, "203.0.113.7"))).status).toBe(403);
      expect((await routes(db).elksSms(incoming(TOKEN, null))).status).toBe(403);
      expect(await inbound(db, tenantId)).toHaveLength(0);
      // The IPv6 address is on the list too.
      expect((await routes(db).elksSms(incoming(TOKEN, "2001:9b0:2:902::199"))).status).toBe(204);
    });
  });

  it("logs and interprets the sms, and answers with no body", async () => {
    await withRollback(async (db) => {
      const tenantId = await firm(db);
      const response = await routes(db).elksSms(incoming(TOKEN, "176.10.154.199", "STOPP"));
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      const rows = await inbound(db, tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fromAddress: PHONE, body: "STOPP", intent: "stop" });
    });
  });

  it("refuses a form without the fields 46elks sends", async () => {
    await withRollback(async (db) => {
      await firm(db);
      const request = new Request(`https://app.bojen.test/api/webhooks/elks/sms?token=${TOKEN}`, {
        method: "POST",
        headers: { "x-real-ip": "176.10.154.199" },
        body: "from=%2B46701112255",
      });
      expect((await routes(db).elksSms(request)).status).toBe(400);
    });
  });

  it("the delivery reports have the same protection", async () => {
    await withRollback(async (db) => {
      const report = (ip: string) =>
        new Request(`https://app.bojen.test/api/webhooks/elks/delivery?token=${TOKEN}`, {
          method: "POST",
          headers: { "x-real-ip": ip },
          body: new URLSearchParams({ id: "s-unknown", status: "delivered" }).toString(),
        });
      expect((await routes(db).elksDelivery(report("203.0.113.7"))).status).toBe(403);
      expect((await routes(db).elksDelivery(report("85.24.146.132"))).status).toBe(200);
    });
  });
});
