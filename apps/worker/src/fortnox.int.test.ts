import { FortnoxError, createFakeFortnox, createLocalKms } from "@bojen/adapters";
import { stockholmInstant } from "@bojen/core";
import {
  boat,
  connect,
  customer,
  databaseUrl,
  fortnoxConnection,
  fortnoxStatus,
  job,
  saveFortnoxConnection,
  serviceReport,
  serviceType,
  tenant,
  visit,
  type Database,
} from "@bojen/db";
import { runMigrations } from "@bojen/db/migrate";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFortnoxPayments, queueFortnoxInvoice, sendFortnoxInvoice } from "./flows/fortnox";

/**
 * The invoice to Fortnox and its payment (byggplan step 8), against the fake Fortnox, which
 * rotates refresh tokens as the real one does. Everything runs in a transaction that is rolled
 * back.
 */
const url = databaseUrl();
const connection = connect(url);
afterAll(() => connection.close());
beforeAll(() => runMigrations(url), 60_000);

class Rollback extends Error {}
async function inRollback(fn: (db: Database) => Promise<void>) {
  try {
    await connection.db.transaction(async (raw) => {
      await fn(raw as unknown as Database);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const INVOICE = {
  lines: [
    {
      type: "labour" as const,
      description: "Årsservice",
      quantity: 2,
      unitPriceOre: 95_000,
      amountOre: 190_000,
    },
  ],
  netOre: 190_000,
  vatOre: 47_500,
  grossOre: 237_500,
};

async function firm(db: Database) {
  const [t] = await db
    .insert(tenant)
    .values({ name: "Fortnoxfirman", settings: { fortnox: { articles: { labour: "101" } } } })
    .returning();
  const tenantId = t!.id;
  const [c] = await db
    .insert(customer)
    .values({
      tenantId,
      name: "Per Persson",
      phone: "+46701112233",
      billingAddress: "Strandvägen 1, 111 22 Stockholm",
    })
    .returning();
  const [b] = await db.insert(boat).values({ tenantId, name: "Bustern" }).returning();
  const [s] = await db
    .insert(serviceType)
    .values({ tenantId, name: "Vårservice", defaultDurationMinutes: 120 })
    .returning();
  const [j] = await db
    .insert(job)
    .values({
      tenantId,
      customerId: c!.id,
      boatId: b!.id,
      serviceTypeId: s!.id,
      channel: "phone",
      pipelineStatus: "done",
    })
    .returning();
  const start = stockholmInstant("2027-03-28", "08:00");
  const [v] = await db
    .insert(visit)
    .values({
      tenantId,
      jobId: j!.id,
      timeWindow: `[${start.toISOString()},${new Date(start.getTime() + 7_200_000).toISOString()})`,
      plannedMinutes: 120,
      status: "done",
    })
    .returning();
  await db.insert(serviceReport).values({
    tenantId,
    visitId: v!.id,
    status: "approved",
    approvedAt: start,
    invoice: INVOICE,
  });
  return { tenantId, customerId: c!.id, jobId: j!.id, visitId: v!.id };
}

describe("Fortnox (step 8)", () => {
  it("makes the invoice once, with the firm's article, and moves the card when it is paid", async () => {
    await inRollback(async (db) => {
      const f = await firm(db);
      const fortnox = createFakeFortnox();
      const clock = { now: new Date("2027-03-28T17:00:00Z") };
      const deps = { db, kms: createLocalKms(randomBytes(32)), fortnox, now: () => clock.now };

      expect(await queueFortnoxInvoice(deps, f.tenantId, f.visitId)).toBe(false);
      const tokens = await fortnox.exchangeCode({
        code: "good-code",
        redirectUri: "x",
        verifier: "v",
      });
      await saveFortnoxConnection(deps, {
        tenantId: f.tenantId,
        tokens,
        companyName: "Fortnoxfirman AB",
        connectedBy: null,
        now: clock.now,
      });
      expect(await queueFortnoxInvoice(deps, f.tenantId, f.visitId)).toBe(true);

      // The tokens are stored encrypted, never as they are.
      const [stored] = await db
        .select()
        .from(fortnoxConnection)
        .where(eq(fortnoxConnection.tenantId, f.tenantId));
      expect(stored?.accessTokenEncrypted.toString("utf8")).not.toContain(tokens.accessToken);

      expect(await sendFortnoxInvoice(deps, f.tenantId, f.visitId)).toBe("invoiced");
      const [sent] = [...fortnox.invoices.values()];
      expect(sent?.invoice).toMatchObject({
        CustomerNumber: "1",
        InvoiceDate: "2027-03-28",
        DueDate: "2027-04-07",
        ExternalInvoiceReference1: `bojen:${f.visitId}`,
        InvoiceRows: [
          {
            ArticleNumber: "101",
            Description: "Årsservice",
            DeliveredQuantity: "2",
            Price: 950,
            VAT: 25,
          },
        ],
      });
      expect(fortnox.customers.get("1")).toMatchObject({ Name: "Per Persson", ZipCode: "111 22" });
      const statusOf = async () =>
        (await db.select({ s: job.pipelineStatus }).from(job).where(eq(job.id, f.jobId)))[0]?.s;
      expect(await statusOf()).toBe("invoiced");

      // A retry makes no second invoice.
      expect(await sendFortnoxInvoice(deps, f.tenantId, f.visitId)).toBe("already");
      expect(fortnox.invoices.size).toBe(1);

      expect(await checkFortnoxPayments(deps)).toMatchObject({ checked: 1, paid: 0 });
      fortnox.pay("1");
      // Two hours on: the access token has run out and is refreshed on the way.
      clock.now = new Date("2027-03-28T19:00:00Z");
      expect(await checkFortnoxPayments(deps)).toMatchObject({ checked: 1, paid: 1 });
      expect(fortnox.calls).toContain("refresh");
      expect(await statusOf()).toBe("paid");
      expect(await checkFortnoxPayments(deps)).toMatchObject({ checked: 0 });
    });
  });

  it("finds an invoice made before a timeout instead of making a second", async () => {
    await inRollback(async (db) => {
      const f = await firm(db);
      const fortnox = createFakeFortnox();
      const now = new Date("2027-03-28T17:00:00Z");
      const deps = { db, kms: createLocalKms(randomBytes(32)), fortnox, now: () => now };
      const tokens = await fortnox.exchangeCode({
        code: "good-code",
        redirectUri: "x",
        verifier: "v",
      });
      await saveFortnoxConnection(deps, {
        tenantId: f.tenantId,
        tokens,
        companyName: null,
        connectedBy: null,
        now,
      });
      await fortnox.createInvoice(tokens.accessToken, {
        ExternalInvoiceReference1: `bojen:${f.visitId}`,
        InvoiceRows: [],
      });
      expect(await sendFortnoxInvoice(deps, f.tenantId, f.visitId)).toBe("invoiced");
      expect(fortnox.invoices.size).toBe(1);
      expect(fortnox.calls).not.toContain("createCustomer");
    });
  });

  it("marks the connection when Fortnox no longer takes the refresh token", async () => {
    await inRollback(async (db) => {
      const f = await firm(db);
      const fortnox = createFakeFortnox();
      const clock = { now: new Date("2027-03-28T17:00:00Z") };
      const deps = { db, kms: createLocalKms(randomBytes(32)), fortnox, now: () => clock.now };
      const tokens = await fortnox.exchangeCode({
        code: "good-code",
        redirectUri: "x",
        verifier: "v",
      });
      await saveFortnoxConnection(deps, {
        tenantId: f.tenantId,
        tokens,
        companyName: null,
        connectedBy: null,
        now: clock.now,
      });
      clock.now = new Date("2027-03-28T19:00:00Z");
      fortnox.failNext(new FortnoxError(400, null, "invalid_grant"));
      expect(await sendFortnoxInvoice(deps, f.tenantId, f.visitId)).toBe("reconnect");
      expect((await fortnoxStatus(db, f.tenantId))?.needsReconnect).toBe(true);
      expect(await queueFortnoxInvoice(deps, f.tenantId, f.visitId)).toBe(false);
      const jobs = await db.execute(
        sql`select 1 from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id where t.identifier = 'fortnox_invoice' and j.key = ${`fortnox:${f.visitId}`}`,
      );
      expect([...jobs]).toHaveLength(0);
    });
  });
});
