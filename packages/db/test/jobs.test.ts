import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { appUser, job, jobPart, part, visit } from "../src/schema";
import { timeRange } from "../src/schema/_types";
import { closeDb, createTenantWithBoat, expectDbError, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

/** 20 April 2027 in UTC; Stockholm is UTC+2 then, so 06:00Z is 08:00 local time. */
const at = (hhmm: string) => new Date(`2027-04-20T${hhmm}:00Z`);

async function firmWithJob(tx: Tx) {
  // The helper already books A's mechanic 06:00–08:00Z on 20 April 2027.
  const firm = await createTenantWithBoat(tx, "A", "+46700000001");
  const newVisit = (mechanicId: string | null, from: string, to: string) => ({
    tenantId: firm.tenantId,
    jobId: firm.jobId,
    mechanicId,
    timeWindow: timeRange(at(from), at(to)),
    plannedMinutes: 60,
    status: "booked" as const,
  });
  return { ...firm, newVisit };
}

describe("jobs, visits and parts (step 1.3)", () => {
  it("rejects an overlapping visit for the same mechanic", async () => {
    await withRollback(async (tx) => {
      const { mechanicId, newVisit } = await firmWithJob(tx);
      const error = await expectDbError(tx, (sp) =>
        sp.insert(visit).values(newVisit(mechanicId, "07:00", "09:00")),
      );
      expect(String(error.cause ?? error)).toMatch(/visit_no_overlap_per_mechanic/);
    });
  });

  it("allows back-to-back visits, another mechanic at the same time, and unassigned visits", async () => {
    await withRollback(async (tx) => {
      const { tenantId, mechanicId, newVisit } = await firmWithJob(tx);
      const [colleague] = await tx
        .insert(appUser)
        .values({ tenantId, name: "Kollega", role: "mechanic" })
        .returning();

      await tx.insert(visit).values([
        newVisit(mechanicId, "08:00", "10:00"), // starts when the first one ends
        newVisit(colleague!.id, "06:30", "07:30"),
        newVisit(null, "06:00", "08:00"),
        newVisit(null, "06:00", "08:00"),
      ]);
      const rows = await tx.select().from(visit).where(eq(visit.tenantId, tenantId));
      expect(rows).toHaveLength(5);
    });
  });

  it("frees the time when a visit is cancelled", async () => {
    await withRollback(async (tx) => {
      const { tenantId, mechanicId, newVisit } = await firmWithJob(tx);
      await tx.update(visit).set({ status: "cancelled" }).where(eq(visit.tenantId, tenantId));
      await tx.insert(visit).values(newVisit(mechanicId, "06:00", "08:00"));

      // Reopening the cancelled visit would double-book the mechanic.
      const error = await expectDbError(tx, (sp) =>
        sp.update(visit).set({ status: "booked" }).where(eq(visit.status, "cancelled")),
      );
      expect(String(error.cause ?? error)).toMatch(/visit_no_overlap_per_mechanic/);
    });
  });

  it("rejects an empty or open-ended time window", async () => {
    await withRollback(async (tx) => {
      const { mechanicId, newVisit } = await firmWithJob(tx);
      const empty = await expectDbError(tx, (sp) =>
        sp.insert(visit).values(newVisit(mechanicId, "12:00", "12:00")),
      );
      expect(String(empty.cause ?? empty)).toMatch(/visit_time_window_bounded/);

      const open = await expectDbError(tx, (sp) =>
        sp.insert(visit).values({
          ...newVisit(mechanicId, "12:00", "13:00"),
          timeWindow: "[2027-04-20T12:00Z,)",
        }),
      );
      expect(String(open.cause ?? open)).toMatch(/visit_time_window_bounded/);
    });
  });

  it("keeps a job with defaults and lists its parts", async () => {
    await withRollback(async (tx) => {
      const { jobId } = await firmWithJob(tx);
      const [j] = await tx.select().from(job).where(eq(job.id, jobId));
      expect(j).toMatchObject({ pipelineStatus: "inquiry", urgency: "planned", channel: "phone" });

      const parts = await tx
        .select({
          description: part.description,
          status: jobPart.status,
          quantity: jobPart.quantity,
        })
        .from(jobPart)
        .innerJoin(part, eq(part.id, jobPart.partId))
        .where(eq(jobPart.jobId, jobId));
      expect(parts).toEqual([{ description: "Impeller", status: "needed", quantity: "1.00" }]);
    });
  });

  it("refuses a visit on another tenant's job or with another tenant's mechanic", async () => {
    await withRollback(async (tx) => {
      const a = await createTenantWithBoat(tx, "A", "+46700000001");
      const b = await createTenantWithBoat(tx, "B", "+46700000002");
      const window = timeRange(at("12:00"), at("13:00"));

      const foreignJob = await expectDbError(tx, (sp) =>
        sp.insert(visit).values({
          tenantId: a.tenantId,
          jobId: b.jobId,
          timeWindow: window,
          plannedMinutes: 60,
        }),
      );
      expect(String(foreignJob.cause ?? foreignJob)).toMatch(/visit_job_fk/);

      const foreignMechanic = await expectDbError(tx, (sp) =>
        sp.insert(visit).values({
          tenantId: a.tenantId,
          jobId: a.jobId,
          mechanicId: b.mechanicId,
          timeWindow: window,
          plannedMinutes: 60,
        }),
      );
      expect(String(foreignMechanic.cause ?? foreignMechanic)).toMatch(/visit_mechanic_fk/);
    });
  });
});
