import { createFakeStorage } from "@bojen/adapters";
import { stockholmInstant } from "@bojen/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { approvalNeeded, customerKindOf, pendingRequests } from "../src/approval";
import { changeBooking, createBooking } from "../src/booking";
import { submitPublicBooking } from "../src/public-booking";
import {
  appUser,
  approvalRule,
  customer,
  location,
  serviceType,
  tenant,
  visit,
  workSchedule,
} from "../src/schema";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const NOW = stockholmInstant("2027-09-06", "08:00");
const at = (day: string) => stockholmInstant(day, "08:00");

async function firm(tx: Tx) {
  const [t] = await tx
    .insert(tenant)
    .values({ name: "Godkännandefirman", slug: `godk-${crypto.randomUUID().slice(0, 8)}` })
    .returning();
  const tenantId = t!.id;
  const [jonas] = await tx
    .insert(appUser)
    .values({ tenantId, name: "Jonas", role: "mechanic" })
    .returning();
  await tx.insert(workSchedule).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      tenantId,
      userId: jonas!.id,
      weekday,
      startTime: "07:00",
      endTime: "17:00",
    })),
  );
  const [bullando] = await tx
    .insert(location)
    .values({
      tenantId,
      type: "marina",
      name: "Bullandö Marina",
      position: { lng: 18.65, lat: 59.3 },
    })
    .returning();
  const [layUp, spring] = await tx
    .insert(serviceType)
    .values([
      { tenantId, name: "Vinterkonservering", defaultDurationMinutes: 120 },
      { tenantId, name: "Vårservice", defaultDurationMinutes: 120 },
    ])
    .returning();
  const [regular] = await tx
    .insert(customer)
    .values({ tenantId, name: "Stamkund", phone: "+46701740611" })
    .returning();
  const staff = { type: "staff" as const, id: jonas!.id };

  // The regular customer had work done last season.
  const { visit: old } = await createBooking(
    { db: tx, now: () => new Date("2026-09-01T00:00:00Z") },
    { tenantId, actor: staff, idempotencyKey: "last-season" },
    {
      customerId: regular!.id,
      serviceTypeId: spring!.id,
      mechanicId: jonas!.id,
      start: at("2026-09-02"),
      channel: "phone",
      needsApproval: false,
      partsMissing: false,
    },
  );
  await tx.update(visit).set({ status: "done" }).where(eq(visit.id, old.id));

  const deps = { db: tx, storage: createFakeStorage(), now: () => NOW };
  const book = (
    key: string,
    start: Date,
    who: { id: string } | { name: string; phone: string },
    service = layUp!.id,
  ) =>
    submitPublicBooking(deps, { tenantId }, key, {
      serviceTypeId: service,
      mechanicId: jonas!.id,
      start,
      customer: who,
      boat: { name: "Båten", make: "Nimbus" },
      place: { locationId: bullando!.id },
      mode: "land",
    });
  return { tenantId, staff, layUp: layUp!.id, spring: spring!.id, regular: regular!.id, book };
}

describe("approval of customer bookings (step 2.6)", () => {
  it("sends a new customer's booking for approval, and the mechanic's approval books it", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await f.book("new-1", at("2027-09-20"), {
        name: "Ny Kund",
        phone: "0701740612",
      });
      expect(v.status).toBe("pending_approval");

      const waiting = await pendingRequests(tx, f.tenantId);
      expect(waiting.map((r) => [r.visitId, r.customerName, r.service])).toEqual([
        [v.id, "Ny Kund", "Vinterkonservering"],
      ]);

      const approved = await changeBooking(
        { db: tx, now: () => NOW },
        { tenantId: f.tenantId, actor: f.staff, idempotencyKey: "approve-1" },
        v.id,
        { event: "approve" },
      );
      expect(approved.visit.status).toBe("booked");
      expect(await pendingRequests(tx, f.tenantId)).toEqual([]);
    });
  });

  it("books an existing customer at once", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      expect(await customerKindOf(tx, f.tenantId, f.regular)).toBe("existing");
      const { visit: v } = await f.book("regular-1", at("2027-09-21"), { id: f.regular });
      expect(v.status).toBe("booked");
    });
  });

  it("follows the firm's rules per service and customer type", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await tx.insert(approvalRule).values([
        // Lay-up is booked at once even for new customers …
        { tenantId: f.tenantId, serviceTypeId: f.layUp, customerKind: "new", mode: "auto" },
        // … but every spring service is approved by hand, also for regulars.
        { tenantId: f.tenantId, serviceTypeId: f.spring, customerKind: null, mode: "manual" },
      ]);
      const newcomer = await f.book("rule-1", at("2027-09-22"), {
        name: "Ny Två",
        phone: "0701740613",
      });
      expect(newcomer.visit.status).toBe("booked");
      const regular = await f.book("rule-2", at("2027-09-23"), { id: f.regular }, f.spring);
      expect(regular.visit.status).toBe("pending_approval");

      expect(
        await approvalNeeded(tx, f.tenantId, { serviceTypeId: f.layUp, customerId: f.regular }),
      ).toBe(false);
      expect(
        await approvalNeeded(tx, f.tenantId, {
          serviceTypeId: f.layUp,
          customerId: f.regular,
          urgency: "emergency",
        }),
      ).toBe(true);
    });
  });

  it("lets the mechanic reject a request", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await f.book("new-2", at("2027-09-24"), {
        name: "Ny Tre",
        phone: "0701740614",
      });
      const rejected = await changeBooking(
        { db: tx, now: () => NOW },
        { tenantId: f.tenantId, actor: f.staff, idempotencyKey: "reject-1" },
        v.id,
        { event: "reject" },
      );
      expect(rejected.visit.status).toBe("cancelled");
    });
  });
});
