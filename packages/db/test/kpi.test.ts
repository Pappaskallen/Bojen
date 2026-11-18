/**
 * Byggplan step 7.1, "Klart när": every KPI of the MVP against a small firm whose week has
 * been worked out by hand. The week is Monday 5 to Sunday 11 April 2027 (Stockholm is UTC+2).
 *
 * Capacity: Mats works Monday–Friday 07–16 (540 min) with Wednesday 12–16 blocked, so
 * 5 × 540 − 240 = 2460 min; Nora works Monday 08–12, 240 min. Together 2700 min.
 *
 * Visits (L1 and L2 are two marinas, 15 minutes apart by car in one direction of the cache):
 *
 * | # | who  | day | local time  | place | status    | planned | check      |
 * |---|------|-----|-------------|-------|-----------|---------|------------|
 * | 1 | Mats | Mon | 08–10       | L1    | done      | 120     | confirmed  |
 * | 2 | Mats | Mon | 10–11       | L1    | done      | 60      | confirmed  |
 * | 3 | Mats | Mon | 12–13:30    | L2    | done      | 90      | no_reply   |
 * | 4 | Mats | Tue | 08–10       | L2    | no_access | 120     | confirmed  |
 * | 5 | Mats | Tue | 10:30–11:30 | L1    | done      | 60      | not_sent   |
 * | 6 | Mats | Thu | 09–11       | L1    | booked    | 120     | pending    |
 * | 7 | Mats | Thu | 13–15       | L2    | cancelled | 120     | not_sent   | cancelled 1 April
 * | 8 | Mats | Thu | 13–15       | L1    | booked    | 120     | not_sent   | from the waitlist
 * | 9 | Mats | Fri | 08–09       | L1    | cancelled | 60      | not_sent   | cancelled 07:30 that day
 * |10 | Mats | Mon 12 April      | L1    | done      | 60      | confirmed  | outside the week
 * |11 | Nora | Mon | 08–10       | L2    | done      | 120     | confirmed  |
 */
import { computeKpis, kpiLevel } from "@bojen/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { revenueByWeek, reviewClicks, snapshotOn } from "../src/dashboard";
import { kpiTotals, kpiValues, refreshKpiViews, snapshotKpis } from "../src/kpi";
import {
  appUser,
  boat,
  boatPlacement,
  customer,
  domainEvent,
  job,
  jobLine,
  kpiSnapshot,
  location,
  scheduleBlock,
  serviceReport,
  serviceType,
  survey,
  tenant,
  travelCache,
  visit,
  workSchedule,
} from "../src/schema";
import { timeRange } from "../src/schema/_types";
import { asTenantUser, closeDb, expectDbError, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const WEEK = { from: "2027-04-05", to: "2027-04-11" };
/** A Stockholm wall-clock time in April 2027. */
const at = (day: string, hhmm: string) => new Date(`2027-04-${day}T${hhmm}:00+02:00`);
const LONG_AGO = new Date("2027-03-01T08:00:00Z");

async function firm(tx: Tx) {
  const [t] = await tx
    .insert(tenant)
    .values({
      name: "Nyckeltalsfirman",
      // KPI 14 measures this short season, from the Monday below.
      settings: { kpi: { seasons: [{ name: "spring", from: "04-06", to: "04-09" }] } },
    })
    .returning();
  const tenantId = t!.id;
  const [mats, nora] = await tx
    .insert(appUser)
    .values([
      { tenantId, name: "Mats", role: "owner" },
      { tenantId, name: "Nora", role: "mechanic" },
    ])
    .returning();
  await tx.insert(workSchedule).values([
    ...[1, 2, 3, 4, 5].map((weekday) => ({
      tenantId,
      userId: mats!.id,
      weekday,
      startTime: "07:00",
      endTime: "16:00",
    })),
    { tenantId, userId: nora!.id, weekday: 1, startTime: "08:00", endTime: "12:00" },
  ]);
  await tx.insert(scheduleBlock).values({
    tenantId,
    userId: mats!.id,
    during: timeRange(at("07", "12:00"), at("07", "16:00")),
    reason: "Tandläkare",
  });
  const [c] = await tx
    .insert(customer)
    .values({ tenantId, name: "Kund", phone: "+46700007100" })
    .returning();
  const [l1, l2] = await tx
    .insert(location)
    .values([
      { tenantId, type: "marina", name: "L1", position: { lng: 18.69, lat: 59.29 } },
      { tenantId, type: "marina", name: "L2", position: { lng: 18.8, lat: 59.3 } },
    ])
    .returning();
  await tx.insert(travelCache).values({
    tenantId,
    fromLocationId: l1!.id,
    toLocationId: l2!.id,
    departureHour: at("05", "11:00"),
    driveSeconds: 900,
    distanceMeters: 9000,
    provider: "fake",
  });
  const [b1, b2] = await tx
    .insert(boat)
    .values([
      { tenantId, name: "Båt vid L1" },
      { tenantId, name: "Båt vid L2" },
    ])
    .returning();
  for (const [b, l] of [
    [b1!, l1!],
    [b2!, l2!],
  ] as const) {
    await tx.insert(boatPlacement).values({
      tenantId,
      boatId: b.id,
      locationId: l.id,
      season: "summer",
      mode: "water",
      launchDate: "2027-04-01",
      haulOutDate: "2027-10-15",
    });
  }
  const [service] = await tx
    .insert(serviceType)
    .values({ tenantId, name: "Service", defaultDurationMinutes: 120 })
    .returning();
  return { tenantId, mats: mats!.id, nora: nora!.id, c: c!.id, b1: b1!.id, b2: b2!.id, service };
}

type Firm = Awaited<ReturnType<typeof firm>>;

interface VisitSpec {
  who: "mats" | "nora";
  boat: "b1" | "b2";
  day: string;
  from: string;
  to: string;
  status: typeof visit.$inferInsert.status;
  check?: typeof visit.$inferInsert.availabilityStatus;
  channel?: typeof job.$inferInsert.channel;
  /** When the job and its visit were made; long before the week unless given. */
  jobCreated?: Date;
  visitCreated?: Date;
}

async function addVisit(tx: Tx, f: Firm, s: VisitSpec) {
  const start = at(s.day, s.from);
  const end = at(s.day, s.to);
  const [j] = await tx
    .insert(job)
    .values({
      tenantId: f.tenantId,
      customerId: f.c,
      boatId: f[s.boat],
      serviceTypeId: f.service!.id,
      channel: s.channel ?? "web",
      createdAt: s.jobCreated ?? LONG_AGO,
    })
    .returning();
  const [v] = await tx
    .insert(visit)
    .values({
      tenantId: f.tenantId,
      jobId: j!.id,
      mechanicId: f[s.who],
      timeWindow: timeRange(start, end),
      plannedMinutes: (end.getTime() - start.getTime()) / 60_000,
      status: s.status,
      availabilityStatus: s.check ?? "not_sent",
      createdAt: s.visitCreated ?? s.jobCreated ?? LONG_AGO,
    })
    .returning();
  return { jobId: j!.id, visitId: v!.id };
}

async function approve(
  tx: Tx,
  f: Firm,
  v: { jobId: string; visitId: string },
  netOre: number,
  day: string,
  labourHours: string | null | undefined,
) {
  if (labourHours !== undefined) {
    await tx.insert(jobLine).values({
      tenantId: f.tenantId,
      jobId: v.jobId,
      type: "labour",
      description: "Arbete",
      hours: labourHours,
      unitPriceOre: 95_000,
    });
  }
  await tx.insert(serviceReport).values({
    tenantId: f.tenantId,
    visitId: v.visitId,
    status: "approved",
    approvedAt: at(day, "18:00"),
    invoice: { lines: [], netOre, vatOre: netOre / 4, grossOre: (netOre * 5) / 4 },
  });
}

async function answer(tx: Tx, f: Firm, visitId: string, score: number | null, day: string) {
  await tx.insert(survey).values({
    tenantId: f.tenantId,
    visitId,
    score,
    sentAt: at(day, "17:00"),
    answeredAt: score === null ? null : at(day, "19:00"),
  });
}

async function cancelled(tx: Tx, f: Firm, visitId: string, when: Date) {
  await tx.insert(domainEvent).values({
    tenantId: f.tenantId,
    aggregateType: "visit",
    aggregateId: visitId,
    type: "visit.cancel",
    actorType: "customer",
    occurredAt: when,
  });
}

/** The week in the table above. */
async function week(tx: Tx) {
  const f = await firm(tx);
  const v1 = await addVisit(tx, f, {
    who: "mats",
    boat: "b1",
    day: "05",
    from: "08:00",
    to: "10:00",
    status: "done",
    check: "confirmed",
  });
  await addVisit(tx, f, {
    who: "mats",
    boat: "b1",
    day: "05",
    from: "10:00",
    to: "11:00",
    status: "done",
    check: "confirmed",
  });
  const v3 = await addVisit(tx, f, {
    who: "mats",
    boat: "b2",
    day: "05",
    from: "12:00",
    to: "13:30",
    status: "done",
    check: "no_reply",
  });
  await addVisit(tx, f, {
    who: "mats",
    boat: "b2",
    day: "06",
    from: "08:00",
    to: "10:00",
    status: "no_access",
    check: "confirmed",
  });
  const v5 = await addVisit(tx, f, {
    who: "mats",
    boat: "b1",
    day: "06",
    from: "10:30",
    to: "11:30",
    status: "done",
  });
  // Jobs booked in the week (KPI 11): 2, 1 and 6 hours from the job to its first visit.
  await addVisit(tx, f, {
    who: "mats",
    boat: "b1",
    day: "08",
    from: "09:00",
    to: "11:00",
    status: "booked",
    check: "pending",
    jobCreated: at("05", "07:00"),
    visitCreated: at("05", "09:00"),
  });
  const v7 = await addVisit(tx, f, {
    who: "mats",
    boat: "b2",
    day: "08",
    from: "13:00",
    to: "15:00",
    status: "cancelled",
    jobCreated: at("05", "07:00"),
    visitCreated: at("05", "08:00"),
  });
  await cancelled(tx, f, v7.visitId, new Date("2027-04-01T10:00:00Z"));
  await addVisit(tx, f, {
    who: "mats",
    boat: "b1",
    day: "08",
    from: "13:00",
    to: "15:00",
    status: "booked",
    channel: "waitlist",
    jobCreated: at("06", "07:00"),
    visitCreated: at("06", "13:00"),
  });
  const v9 = await addVisit(tx, f, {
    who: "mats",
    boat: "b1",
    day: "09",
    from: "08:00",
    to: "09:00",
    status: "cancelled",
  });
  await cancelled(tx, f, v9.visitId, at("09", "07:30"));
  const v10 = await addVisit(tx, f, {
    who: "mats",
    boat: "b1",
    day: "12",
    from: "08:00",
    to: "09:00",
    status: "done",
    check: "confirmed",
  });
  const v11 = await addVisit(tx, f, {
    who: "nora",
    boat: "b2",
    day: "05",
    from: "08:00",
    to: "10:00",
    status: "done",
    check: "confirmed",
  });

  // Invoice bases: 3 000 kr with 2 h labour, 1 500 kr at a fixed price (the visit's 90 min),
  // 500 kr without labour; one after the week and one not yet approved.
  await approve(tx, f, v1, 300_000, "05", "2.00");
  await approve(tx, f, v3, 150_000, "06", null);
  await approve(tx, f, v5, 50_000, "06", undefined);
  await approve(tx, f, v10, 99_900, "12", "1.00");
  await tx
    .insert(serviceReport)
    .values({ tenantId: f.tenantId, visitId: v11.visitId, status: "draft" });

  await answer(tx, f, v1.visitId, 5, "05");
  await answer(tx, f, v3.visitId, 3, "06");
  await answer(tx, f, v5.visitId, 4, "07");
  await answer(tx, f, v11.visitId, null, "05");

  await refreshKpiViews(tx);
  return f;
}

describe("the KPIs of the MVP (step 7.1)", () => {
  it("come out as worked out by hand for the week", async () => {
    await withRollback(async (tx) => {
      const f = await week(tx);
      const totals = await kpiTotals(tx, f.tenantId, WEEK);
      expect(totals).toEqual({
        revenueOre: 500_000,
        workDays: 2,
        invoicedJobs: 3,
        // Visits 1–6, 8 and 11: 120 + 60 + 90 + 120 + 60 + 120 + 120 + 120.
        bookedMinutes: 810,
        capacityMinutes: 2700,
        // 2 h, and the fixed price as the visit's 90 minutes.
        labourMinutes: 210,
        // L1 → L2 on Monday and L2 → L1 on Tuesday (the cache's other direction).
        driveMinutes: 30,
        onSiteMinutes: 450,
        placeVisits: 5,
        // Mats at L1 and L2 on Monday and L1 on Tuesday, Nora at L2 on Monday.
        marinaStops: 4,
        noAccessVisits: 1,
        doneOrNoAccessVisits: 6,
        checksSent: 6,
        checksConfirmed: 4,
        // Visit 7 was freed days ahead and taken from the waitlist; visit 9 too late to count.
        freedSlots: 1,
        refilledSlots: 1,
        hoursToFirstVisit: expect.arrayContaining([2, 1, 6]) as number[],
        surveysAnswered: 3,
        surveysHappy: 2,
      });

      const { values, season } = await kpiValues(tx, f.tenantId, WEEK, at("05", "12:00"));
      expect(season).toEqual({ name: "spring", from: "2027-04-06", to: "2027-04-09" });
      expect(values).toEqual({
        revenue: 500_000, // KPI 1: 5 000 kr
        revenuePerWorkDay: 250_000, // KPI 2: 2 500 kr over two days
        averageOrder: 500_000 / 3, // KPI 3
        occupancy: 0.3, // KPI 4: 810 / 2700
        billableShare: 210 / 2700, // KPI 5
        driveShare: 30 / 480, // KPI 6: 30 / (30 + 450)
        visitsPerMarinaStop: 1.25, // KPI 7: 5 / 4
        noAccess: 1 / 6, // KPI 8
        confirmation: 4 / 6, // KPI 9
        refill: 1, // KPI 10
        hoursToBooking: 2, // KPI 11: the median of 1, 2 and 6
        // KPI 14: visits 4, 5, 6 and 8 (420 min) against Mats's Tuesday–Friday, 4 × 540 − 240.
        prebooking: 420 / 1920,
        csat: 2 / 3, // KPI 17: 5 and 4 of 5, 4 and 3
      });
      expect(kpiLevel("occupancy", values.occupancy)).toBe("red");
      expect(kpiLevel("refill", values.refill)).toBe("green");
    });
  });

  it("can be narrowed to one mechanic", async () => {
    await withRollback(async (tx) => {
      const f = await week(tx);
      const nora = computeKpis(
        await kpiTotals(tx, f.tenantId, { ...WEEK, mechanicId: f.nora }),
        null,
      );
      expect(nora).toMatchObject({
        revenue: 0,
        occupancy: 0.5, // 120 / 240
        driveShare: 0,
        visitsPerMarinaStop: 1,
        confirmation: 1,
        refill: null,
        csat: null,
      });
    });
  });

  it("keep a daily snapshot of KPI 14 for next year's comparison", async () => {
    await withRollback(async (tx) => {
      const f = await week(tx);
      const now = at("05", "23:30");
      await snapshotKpis(tx, now);
      // A second run the same day keeps one row.
      await snapshotKpis(tx, now);
      const rows = await tx
        .select({ kpi: kpiSnapshot.kpi, day: kpiSnapshot.snapshotDate, value: kpiSnapshot.value })
        .from(kpiSnapshot)
        .where(and(eq(kpiSnapshot.tenantId, f.tenantId)));
      expect(rows).toEqual([
        { kpi: "kpi14_prebooking_spring", day: "2027-04-05", value: "0.2188" },
      ]);
    });
  });
  it("give the dashboard its bars, last year's snapshot and the review clicks (step 7.2)", async () => {
    await withRollback(async (tx) => {
      const f = await week(tx);
      expect(
        await revenueByWeek(tx, f.tenantId, [
          { week: 14, from: "2027-04-05", to: "2027-04-11" },
          { week: 15, from: "2027-04-12", to: "2027-04-18" },
        ]),
      ).toEqual([
        { week: 14, ore: 500_000 },
        { week: 15, ore: 99_900 },
      ]);
      await tx.insert(kpiSnapshot).values({
        tenantId: f.tenantId,
        snapshotDate: "2026-04-03",
        kpi: "kpi14_prebooking_spring",
        value: "0.3100",
      });
      // The same day last year, or the latest snapshot in the week before it.
      expect(await snapshotOn(tx, f.tenantId, "kpi14_prebooking_spring", "2026-04-05")).toBe(0.31);
      expect(await snapshotOn(tx, f.tenantId, "kpi14_prebooking_spring", "2026-04-20")).toBeNull();
      await tx
        .update(survey)
        .set({ reviewLinkClickedAt: at("06", "20:00") })
        .where(and(eq(survey.tenantId, f.tenantId), eq(survey.score, 5)));
      expect(await reviewClicks(tx, f.tenantId, WEEK)).toBe(1);
    });
  });

  it("are out of reach for signed-in users, since the views have no Row Level Security", async () => {
    await withRollback(async (tx) => {
      const f = await week(tx);
      await asTenantUser(tx, f.tenantId);
      for (const view of ["visit_fact", "report_fact", "job_fact", "freed_slot", "capacity_day"]) {
        const error = await expectDbError(tx, (s) =>
          s.execute(sql`select count(*) from ${sql.identifier("kpi")}.${sql.identifier(view)}`),
        );
        expect(String(error.cause ?? error)).toMatch(/permission denied/);
      }
      const refresh = await expectDbError(tx, (s) => s.execute(sql`select kpi.refresh()`));
      expect(String(refresh.cause ?? refresh)).toMatch(/permission denied/);
    });
  });
});
