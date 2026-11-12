import { createFakeEmail, createFakeSms } from "@bojen/adapters";
import { connect, customer, databaseUrl, message, queueSms, tenant } from "@bojen/db";
import { runMigrations } from "@bojen/db/migrate";
import { eq } from "drizzle-orm";
import { runOnce } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { taskList } from "./tasks";

/**
 * The whole way out against the local database: queueSms adds a Graphile job, and the
 * worker picks it up and sends it. The data is committed, so the test cleans up after itself.
 */
const url = databaseUrl();
const { db, close } = connect(url);
const KEY = "worker-test-opt-out-key";
const PHONE = "+46701119988";
let tenantId = "";

beforeAll(async () => {
  await runMigrations(url);
  const [t] = await db.insert(tenant).values({ name: "Arbetarfirman" }).returning();
  tenantId = t?.id ?? "";
}, 60_000);

afterAll(async () => {
  await db.delete(message).where(eq(message.tenantId, tenantId));
  await db.delete(customer).where(eq(customer.tenantId, tenantId));
  await db.delete(tenant).where(eq(tenant.id, tenantId));
  await close();
});

describe("send_message", () => {
  it("the worker picks up a queued sms, sends it and marks it sent", async () => {
    const [c] = await db
      .insert(customer)
      .values({ tenantId, name: "Per", phone: PHONE })
      .returning();
    // Queued at a daytime moment in the past, so the job is due whenever the test runs.
    const queuedAt = new Date("2026-11-12T10:00:00+01:00");
    const queued = await queueSms(
      { db, now: () => queuedAt, optOutKey: KEY },
      { tenantId, to: PHONE, customerId: c?.id ?? "" },
      "f6_on_way",
      { mechanicFirstName: "Jonas", placeShort: "Bullandö", eta: "10:15", firm: "Arbetarfirman" },
    );
    expect(queued.status).toBe("queued");

    const sms = createFakeSms();
    await runOnce({
      connectionString: url,
      taskList: taskList({
        db,
        sms,
        email: createFakeEmail(),
        now: () => new Date(),
        optOutKey: KEY,
        link: () => "bojen.se/boka/test",
      }),
    });
    expect(sms.lastTo(PHONE)).toBe(
      "Jonas är på väg till Bullandö, framme ca kl 10:15. /Arbetarfirman",
    );
    const [row] = await db.select().from(message).where(eq(message.id, queued.messageId));
    expect(row?.status).toBe("sent");
  }, 60_000);
});
