import { stockholmInstant } from "@bojen/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  BookingError,
  changeBooking,
  createBooking,
  type BookingContext,
  type BookingDeps,
  type CreateBookingInput,
} from "../src/booking";
import {
  appUser,
  customer,
  domainEvent,
  serviceType,
  tenant,
  visit,
  workSchedule,
} from "../src/schema";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const DAY = "2027-04-20"; // Tuesday
const at = (hhmm: string, day = DAY) => stockholmInstant(day, hhmm);

async function firm(tx: Tx) {
  const [t] = await tx.insert(tenant).values({ name: "Bokningsfirman" }).returning();
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
  const [anna, bertil] = await tx
    .insert(customer)
    .values([
      { tenantId, name: "Anna", phone: "+46701740601" },
      { tenantId, name: "Bertil", phone: "+46701740602" },
    ])
    .returning();
  const [service] = await tx
    .insert(serviceType)
    .values({ tenantId, name: "Vårservice", defaultDurationMinutes: 120 })
    .returning();

  let n = 0;
  const ctx = (actor: BookingContext["actor"], key = `key-${++n}`): BookingContext => ({
    tenantId,
    actor,
    idempotencyKey: key,
  });
  const staff = { type: "staff" as const, id: jonas!.id };
  const booking = (start: Date, more: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
    customerId: anna!.id,
    serviceTypeId: service!.id,
    mechanicId: jonas!.id,
    start,
    channel: "web",
    needsApproval: false,
    partsMissing: false,
    ...more,
  });
  const deps = (now = new Date("2027-04-01T08:00:00Z")): BookingDeps => ({
    db: tx,
    now: () => now,
  });
  return {
    tenantId,
    mechanicId: jonas!.id,
    anna: anna!.id,
    bertil: bertil!.id,
    ctx,
    staff,
    booking,
    deps,
  };
}

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BookingError)
      return `${error.code}${error.detail ? ` ${error.detail}` : ""}`;
    throw error;
  }
  return "ok";
}

describe("createBooking", () => {
  it("books a free time and writes an event", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v, replayed } = await createBooking(
        f.deps(),
        f.ctx(f.staff),
        f.booking(at("08:00")),
      );
      expect(replayed).toBe(false);
      expect(v).toMatchObject({
        status: "booked",
        start: "2027-04-20T06:00:00.000Z",
        end: "2027-04-20T08:00:00.000Z",
        plannedMinutes: 120,
      });
      const events = await tx.select().from(domainEvent).where(eq(domainEvent.aggregateId, v.id));
      expect(events.map((e) => [e.type, e.actorType])).toEqual([["visit.created", "staff"]]);
    });
  });

  it("refuses times outside working hours, too close to another visit or in the past", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await createBooking(f.deps(), f.ctx(f.staff), f.booking(at("08:00")));
      expect(await code(createBooking(f.deps(), f.ctx(f.staff), f.booking(at("06:00"))))).toBe(
        "conflict outside_working_hours",
      );
      // 10:00 is the end of the first visit; the 15 min buffer is not respected.
      expect(await code(createBooking(f.deps(), f.ctx(f.staff), f.booking(at("10:00"))))).toBe(
        "conflict overlaps_visit",
      );
      expect(await code(createBooking(f.deps(), f.ctx(f.staff), f.booking(at("10:15"))))).toBe(
        "ok",
      );
      expect(
        await code(
          createBooking(f.deps(new Date("2027-05-01Z")), f.ctx(f.staff), f.booking(at("13:00"))),
        ),
      ).toBe("invalid_input start is in the past");
    });
  });

  it("answers a repeated request with the stored booking", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const first = await createBooking(f.deps(), f.ctx(f.staff, "same"), f.booking(at("08:00")));
      const again = await createBooking(f.deps(), f.ctx(f.staff, "same"), f.booking(at("08:00")));
      expect(again).toEqual({ visit: first.visit, replayed: true });
      const visits = await tx.select().from(visit).where(eq(visit.tenantId, f.tenantId));
      expect(visits).toHaveLength(1);

      expect(
        await code(createBooking(f.deps(), f.ctx(f.staff, "same"), f.booking(at("13:00")))),
      ).toBe("idempotency_mismatch");
    });
  });

  it("starts with approval or parts when the firm asks for it", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const pending = await createBooking(
        f.deps(),
        f.ctx(f.staff),
        f.booking(at("08:00"), { needsApproval: true }),
      );
      const waiting = await createBooking(
        f.deps(),
        f.ctx(f.staff),
        f.booking(at("13:00"), { partsMissing: true }),
      );
      expect(pending.visit.status).toBe("pending_approval");
      expect(waiting.visit.status).toBe("tentative");
    });
  });

  it("lets customers book only for themselves", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const asBertil = f.ctx({ type: "customer", id: f.bertil });
      expect(await code(createBooking(f.deps(), asBertil, f.booking(at("08:00"))))).toBe(
        "forbidden",
      );
    });
  });
});

describe("changeBooking", () => {
  it("approves a pending visit and refuses to approve it twice", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await createBooking(
        f.deps(),
        f.ctx(f.staff),
        f.booking(at("08:00"), { needsApproval: true }),
      );
      const approved = await changeBooking(f.deps(), f.ctx(f.staff), v.id, { event: "approve" });
      expect(approved.visit.status).toBe("booked");
      expect(await code(changeBooking(f.deps(), f.ctx(f.staff), v.id, { event: "approve" }))).toBe(
        "invalid_transition booked → approve",
      );
      const events = await tx.select().from(domainEvent).where(eq(domainEvent.aggregateId, v.id));
      expect(events.map((e) => e.type)).toEqual(["visit.created", "visit.approve"]);
    });
  });

  it("lets the customer cancel until 48 hours before, and only their own visit", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await createBooking(f.deps(), f.ctx(f.staff), f.booking(at("08:00")));
      const anna = { type: "customer" as const, id: f.anna };
      const bertil = { type: "customer" as const, id: f.bertil };

      expect(await code(changeBooking(f.deps(), f.ctx(bertil), v.id, { event: "cancel" }))).toBe(
        "not_found visit",
      );
      expect(await code(changeBooking(f.deps(), f.ctx(anna), v.id, { event: "approve" }))).toBe(
        "forbidden",
      );
      const late = f.deps(at("09:00", "2027-04-18")); // 47 h before
      expect(await code(changeBooking(late, f.ctx(anna), v.id, { event: "cancel" }))).toBe(
        "too_late",
      );
      // Confirming is fine at any time.
      expect(await code(changeBooking(late, f.ctx(anna), v.id, { event: "confirm" }))).toBe("ok");
      const done = await changeBooking(f.deps(), f.ctx(anna), v.id, { event: "cancel" });
      expect(done.visit.status).toBe("cancelled");

      // The cancelled time is free again.
      expect(await code(createBooking(f.deps(), f.ctx(f.staff), f.booking(at("08:00"))))).toBe(
        "ok",
      );
    });
  });

  it("reschedules a confirmed visit back to booked and checks the new time", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await createBooking(f.deps(), f.ctx(f.staff), f.booking(at("08:00")));
      await createBooking(f.deps(), f.ctx(f.staff), f.booking(at("13:00")));
      await changeBooking(f.deps(), f.ctx({ type: "system", id: null }), v.id, {
        event: "confirm",
      });

      expect(
        await code(
          changeBooking(f.deps(), f.ctx(f.staff), v.id, {
            event: "reschedule",
            start: at("12:00"),
          }),
        ),
      ).toBe("conflict overlaps_visit");
      // Moving later on the same morning overlaps only the visit itself, which is ignored.
      const moved = await changeBooking(f.deps(), f.ctx(f.staff), v.id, {
        event: "reschedule",
        start: at("09:00"),
      });
      expect(moved.visit).toMatchObject({ status: "booked", start: "2027-04-20T07:00:00.000Z" });
      const [row] = await tx
        .select({ availability: visit.availabilityStatus })
        .from(visit)
        .where(and(eq(visit.tenantId, f.tenantId), eq(visit.id, v.id)));
      expect(row?.availability).toBe("not_sent");
    });
  });

  it("does not find visits of another firm", async () => {
    await withRollback(async (tx) => {
      const a = await firm(tx);
      const b = await firm(tx);
      const { visit: v } = await createBooking(a.deps(), a.ctx(a.staff), a.booking(at("08:00")));
      expect(await code(changeBooking(b.deps(), b.ctx(b.staff), v.id, { event: "cancel" }))).toBe(
        "not_found visit",
      );
    });
  });
});
