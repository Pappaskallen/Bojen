import { stockholmInstant } from "@bojen/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { invoiceExportRows, markMonthInvoiced } from "../src/invoice-export";
import { boat, customer, job, serviceReport, serviceType, tenant, visit } from "../src/schema";
import { timeRange } from "../src/schema/_types";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const NOW = new Date("2027-04-02T08:00:00Z");
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

async function firm(tx: Tx, name: string) {
  const [t] = await tx.insert(tenant).values({ name }).returning();
  const tenantId = t!.id;
  const [c] = await tx
    .insert(customer)
    .values({ tenantId, name: `${name} kund`, phone: "+46701112233", billingAddress: "Väg 1" })
    .returning();
  const [b] = await tx
    .insert(boat)
    .values({ tenantId, name: "Bustern", make: "Nimbus", model: "26" })
    .returning();
  const [s] = await tx
    .insert(serviceType)
    .values({ tenantId, name: "Vårservice", defaultDurationMinutes: 120 })
    .returning();

  /** A done visit on `day` at 08:00 Stockholm, with its report approved or still a draft. */
  async function visitOn(day: string, approved: boolean) {
    const [j] = await tx
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
    const start = stockholmInstant(day, "08:00");
    const [v] = await tx
      .insert(visit)
      .values({
        tenantId,
        jobId: j!.id,
        timeWindow: timeRange(start, new Date(start.getTime() + 2 * 3_600_000)),
        plannedMinutes: 120,
        status: "done",
      })
      .returning();
    await tx
      .insert(serviceReport)
      .values(
        approved
          ? { tenantId, visitId: v!.id, status: "approved", approvedAt: start, invoice: INVOICE }
          : { tenantId, visitId: v!.id, status: "draft" },
      );
    return j!.id;
  }
  return { tenantId, visitOn };
}

const statusOf = async (tx: Tx, jobId: string) =>
  (await tx.select({ s: job.pipelineStatus }).from(job).where(eq(job.id, jobId)))[0]?.s;

describe("invoice export", () => {
  it("gives the month's approved bases by the visit's day in Stockholm, and only the firm's", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx, "Exportfirman");
      const other = await firm(tx, "Andra firman");
      await f.visitOn("2027-03-01", true);
      await f.visitOn("2027-03-31", true);
      await f.visitOn("2027-03-15", false);
      await f.visitOn("2027-04-01", true);
      await other.visitOn("2027-03-10", true);

      const rows = await invoiceExportRows(tx, f.tenantId, "2027-03");
      expect(rows?.map((r) => r.day)).toEqual(["2027-03-01", "2027-03-31"]);
      expect(rows?.[0]).toMatchObject({
        customer: "Exportfirman kund",
        billingAddress: "Väg 1",
        boat: "Bustern, Nimbus 26",
        service: "Vårservice",
        grossOre: 237_500,
      });
      expect(await invoiceExportRows(tx, f.tenantId, "mars")).toBeNull();
    });
  });

  it("marks the month's jobs invoiced once, and leaves the drafts and other months", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx, "Exportfirman");
      const march = await f.visitOn("2027-03-12", true);
      const draft = await f.visitOn("2027-03-13", false);
      const april = await f.visitOn("2027-04-12", true);
      expect(await markMonthInvoiced(tx, f.tenantId, "2027-03", NOW)).toBe(1);
      expect(await statusOf(tx, march)).toBe("invoiced");
      expect(await statusOf(tx, draft)).toBe("done");
      expect(await statusOf(tx, april)).toBe("done");
      expect(await markMonthInvoiced(tx, f.tenantId, "2027-03", NOW)).toBe(0);
    });
  });
});
