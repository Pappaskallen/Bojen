import { stockholmInstant } from "@bojen/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { changeBooking, createBooking, type BookingContext } from "../src/booking";
import { PipelineError, jobAfterInvoice, moveCard, pipelineBoard } from "../src/pipeline";
import {
  appUser,
  boat,
  customer,
  domainEvent,
  job,
  serviceType,
  tenant,
  visit,
  workSchedule,
} from "../src/schema";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const at = (day: string, hhmm: string) => stockholmInstant(day, hhmm);
const NOW = new Date("2027-04-01T08:00:00Z");

async function firm(tx: Tx) {
  const [t] = await tx.insert(tenant).values({ name: "Pipelinefirman" }).returning();
  const tenantId = t!.id;
  const [jonas, elin, owner] = await tx
    .insert(appUser)
    .values([
      { tenantId, name: "Jonas", role: "mechanic" },
      { tenantId, name: "Elin", role: "mechanic" },
      { tenantId, name: "Ägaren", role: "owner" },
    ])
    .returning();
  await tx.insert(workSchedule).values(
    [jonas!, elin!].flatMap((m) =>
      [1, 2, 3, 4, 5].map((weekday) => ({
        tenantId,
        userId: m.id,
        weekday,
        startTime: "07:00",
        endTime: "17:00",
      })),
    ),
  );
  const [anna, bertil] = await tx
    .insert(customer)
    .values([
      { tenantId, name: "Anna", phone: "+46701740701" },
      { tenantId, name: "Bertil", phone: "+46701740702" },
    ])
    .returning();
  const [b] = await tx.insert(boat).values({ tenantId, name: "Bustern" }).returning();
  const [service] = await tx
    .insert(serviceType)
    .values({ tenantId, name: "Vårservice", defaultDurationMinutes: 120 })
    .returning();

  let n = 0;
  const ctx = (actor: BookingContext["actor"]): BookingContext => ({
    tenantId,
    actor,
    idempotencyKey: `p-${String(++n)}`,
  });
  const deps = { db: tx, now: () => NOW };
  const staff = { type: "staff" as const, id: jonas!.id };
  const book = (customerId: string, start: Date, mechanicId = jonas!.id) =>
    createBooking(deps, ctx(staff), {
      customerId,
      boatId: b!.id,
      serviceTypeId: service!.id,
      mechanicId,
      start,
      channel: "phone",
      needsApproval: false,
      partsMissing: false,
    });
  const finish = async (visitId: string) => {
    const later = { db: tx, now: () => new Date("2027-04-20T12:00:00Z") };
    await changeBooking(later, ctx(staff), visitId, { event: "start" });
    await changeBooking(later, ctx(staff), visitId, { event: "complete" });
  };
  const statusOf = async (jobId: string) =>
    (await tx.select({ s: job.pipelineStatus }).from(job).where(eq(job.id, jobId)))[0]?.s;
  return {
    tenantId,
    jonas: jonas!.id,
    elin: elin!.id,
    owner: owner!.id,
    anna: anna!.id,
    bertil: bertil!.id,
    book,
    finish,
    statusOf,
  };
}

describe("the pipeline board", () => {
  it("puts every job in its column, soonest visit first, and leaves cancelled jobs out", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const later = await f.book(f.anna, at("2027-04-22", "08:00"));
      const sooner = await f.book(f.bertil, at("2027-04-20", "08:00"));
      const gone = await f.book(f.anna, at("2027-04-23", "08:00"));
      await tx.update(job).set({ pipelineStatus: "cancelled" }).where(eq(job.id, gone.visit.jobId));
      await tx.update(job).set({ pipelineStatus: "quote" }).where(eq(job.id, later.visit.jobId));

      const board = await pipelineBoard(tx, f.tenantId);
      expect(Object.keys(board)).toEqual([
        "inquiry",
        "quote",
        "parts_ordered",
        "booked",
        "done",
        "invoiced",
        "paid",
      ]);
      expect(board.booked.map((c) => c.jobId)).toEqual([sooner.visit.jobId]);
      expect(board.quote.map((c) => c.customer)).toEqual(["Anna"]);
      expect(board.booked[0]).toMatchObject({
        customer: "Bertil",
        boat: "Bustern",
        service: "Vårservice",
        visitStart: at("2027-04-20", "08:00"),
        mechanicIds: [f.jonas],
      });
      const all = Object.values(board)
        .flat()
        .map((c) => c.jobId);
      expect(all).not.toContain(gone.visit.jobId);
    });
  });
});

describe("moving a card", () => {
  it("lets the owner move any card and records the move", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await f.book(f.anna, at("2027-04-20", "08:00"));
      expect(
        await moveCard(
          tx,
          { tenantId: f.tenantId, userId: f.owner, role: "owner" },
          v.jobId,
          "quote",
        ),
      ).toBe("quote");
      expect(await f.statusOf(v.jobId)).toBe("quote");
      const [event] = await tx
        .select()
        .from(domainEvent)
        .where(
          and(eq(domainEvent.aggregateId, v.jobId), eq(domainEvent.type, "job.pipeline_moved")),
        );
      expect(event).toMatchObject({
        actorType: "staff",
        actorId: f.owner,
        payload: { from: "booked", to: "quote", why: "manual" },
      });
    });
  });

  it("lets a mechanic move only a job where they have a visit", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await f.book(f.anna, at("2027-04-20", "08:00"));
      const jonas = { tenantId: f.tenantId, userId: f.jonas, role: "mechanic" as const };
      const elin = { tenantId: f.tenantId, userId: f.elin, role: "mechanic" as const };
      expect(await moveCard(tx, jonas, v.jobId, "parts_ordered")).toBe("parts_ordered");
      await expect(moveCard(tx, elin, v.jobId, "booked")).rejects.toThrow(PipelineError);
      expect(await f.statusOf(v.jobId)).toBe("parts_ordered");
    });
  });

  it("refuses a status that is not one, and a job of another firm", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const g = await firm(tx);
      const { visit: v } = await f.book(f.anna, at("2027-04-20", "08:00"));
      const owner = { tenantId: f.tenantId, userId: f.owner, role: "owner" as const };
      await expect(moveCard(tx, owner, v.jobId, "deleted")).rejects.toMatchObject({
        code: "invalid_input",
      });
      await expect(
        moveCard(tx, { tenantId: g.tenantId, userId: g.owner, role: "owner" }, v.jobId, "quote"),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await f.statusOf(v.jobId)).toBe("booked");
    });
  });
});

describe("moves that happen on their own", () => {
  it("makes the job done when its last visit is done, not before", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const first = await f.book(f.anna, at("2027-04-20", "08:00"));
      expect(await f.statusOf(first.visit.jobId)).toBe("booked");
      await f.finish(first.visit.id);
      expect(await f.statusOf(first.visit.jobId)).toBe("done");
      const [event] = await tx
        .select()
        .from(domainEvent)
        .where(
          and(
            eq(domainEvent.aggregateId, first.visit.jobId),
            eq(domainEvent.type, "job.pipeline_moved"),
          ),
        );
      expect(event).toMatchObject({
        actorType: "system",
        payload: { from: "booked", to: "done", why: "visit_done" },
      });
    });
  });

  it("keeps a job with a visit left in its column", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const first = await f.book(f.anna, at("2027-04-20", "08:00"));
      // A second visit on the same job, as for a repair after the fault-finding.
      const second = await f.book(f.anna, at("2027-04-22", "08:00"));
      await tx.update(visit).set({ jobId: first.visit.jobId }).where(eq(visit.id, second.visit.id));
      await f.finish(first.visit.id);
      expect(await f.statusOf(first.visit.jobId)).toBe("booked");
    });
  });

  it("makes the job invoiced when an invoice is made, and leaves a paid job alone", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const { visit: v } = await f.book(f.anna, at("2027-04-20", "08:00"));
      await f.finish(v.id);
      expect(await jobAfterInvoice(tx, f.tenantId, v.jobId, NOW)).toBe(true);
      expect(await f.statusOf(v.jobId)).toBe("invoiced");
      await tx.update(job).set({ pipelineStatus: "paid" }).where(eq(job.id, v.jobId));
      expect(await jobAfterInvoice(tx, f.tenantId, v.jobId, NOW)).toBe(false);
      expect(await f.statusOf(v.jobId)).toBe("paid");
    });
  });
});
