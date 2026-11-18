/** Byggplan step 7.3: KPI 21–24 and the call list filtered on outcome. */
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { callList, receptionistStats } from "../src/calls";
import { call, customer, tenant } from "../src/schema";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

// Stockholm is UTC+2 in April 2027; Monday the 5th.
const at = (local: string) => new Date(`2027-04-${local}:00+02:00`);

async function firm(tx: Tx) {
  const [t] = await tx
    .insert(tenant)
    .values({
      name: "Samtalsfirman",
      settings: {
        receptionist: { officeHours: [{ days: [1, 2, 3, 4, 5], from: "08:00", to: "16:00" }] },
      },
    })
    .returning();
  const [c] = await tx
    .insert(customer)
    .values({ tenantId: t!.id, name: "Per Ringare", phone: "+46700007301" })
    .returning();
  const rows: Omit<typeof call.$inferInsert, "tenantId">[] = [
    { startedAt: at("05T09:00"), outcome: "booked", intent: "book", customerId: c!.id },
    { startedAt: at("05T17:00"), outcome: "booked", intent: "emergency" },
    { startedAt: at("05T10:00"), outcome: "message", intent: "book" },
    { startedAt: at("05T11:00"), outcome: "transferred", intent: "emergency" },
    { startedAt: at("05T07:30"), outcome: "message", intent: "question" },
    { startedAt: at("05T12:00"), outcome: "spam", intent: "other" },
    { startedAt: at("06T12:00"), outcome: null, intent: null },
    // Before the period.
    { startedAt: at("01T12:00"), outcome: "booked", intent: "book" },
  ];
  await tx.insert(call).values(
    rows.map((r, i) => ({
      ...r,
      tenantId: t!.id,
      callerNumber: `+4670000740${String(i)}`,
      summary: `- Samtal ${String(i)}`,
    })),
  );
  return t!.id;
}

describe("the receptionist's statistics (step 7.3)", () => {
  it("give KPI 21–24 for the period, without spam", async () => {
    await withRollback(async (tx) => {
      const tenantId = await firm(tx);
      expect(await receptionistStats(tx, tenantId, at("05T00:00"), at("08T00:00"))).toEqual({
        calls: 6, // KPI 21: seven calls, one of them spam
        bookings: 2,
        transferred: 1,
        conversion: 2 / 4, // KPI 22: booked 2 of the 4 who wanted a time or had an emergency
        transferShare: 1 / 6, // KPI 23
        outsideHours: 2 / 6, // KPI 24: 17:00 and 07:30, the firm's hours are 08–16
      });
    });
  });

  it("list the calls newest first, filtered on outcome", async () => {
    await withRollback(async (tx) => {
      const tenantId = await firm(tx);
      const all = await callList(tx, tenantId, null);
      expect(all).toHaveLength(8);
      expect(all[0]?.startedAt).toEqual(at("06T12:00"));
      const booked = await callList(tx, tenantId, "booked");
      expect(booked.map((c) => c.outcome)).toEqual(["booked", "booked", "booked"]);
      expect(booked.find((c) => c.customerId)?.customer).toBe("Per Ringare");
      expect(await callList(tx, tenantId, "none")).toMatchObject([{ outcome: null }]);
      expect(await callList(tx, tenantId, "spam")).toHaveLength(1);
      // Another firm's calls are never in the list.
      const [other] = await tx.insert(tenant).values({ name: "Annan" }).returning();
      expect(await callList(tx, other!.id, null)).toEqual([]);
      expect(
        await tx
          .select()
          .from(call)
          .where(and(eq(call.tenantId, tenantId))),
      ).toHaveLength(8);
    });
  });
});
