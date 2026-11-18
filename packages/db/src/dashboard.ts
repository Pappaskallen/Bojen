/**
 * What the dashboard needs beyond `kpiValues` (byggplan step 7.2, spec 9.2): revenue per
 * week for the bars, KPI 14 on the same day last year, the clicks to the review, and whom
 * and what a card can be broken down by.
 */
import type { Week } from "@bojen/core";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "./client";
import { appUser, kpiSnapshot, serviceType, tenant } from "./schema";

type Db = Pick<Database, "select" | "execute">;

/** Approved invoice bases per week, in öre (the bars under the revenue). */
export async function revenueByWeek(db: Db, tenantId: string, weeks: readonly Week[]) {
  const first = weeks[0];
  const last = weeks.at(-1);
  if (!first || !last) return [];
  const rows = await db.execute<{ day: string; ore: string }>(sql`
    select day::text as day, sum(net_ore) as ore from kpi.report_fact
    where tenant_id = ${tenantId} and day between ${first.from}::date and ${last.to}::date
    group by day`);
  return weeks.map((w) => ({
    week: w.week,
    ore: [...rows]
      .filter((r) => r.day >= w.from && r.day <= w.to)
      .reduce((sum, r) => sum + Number(r.ore), 0),
  }));
}

/**
 * A snapshot kept on `day` or, when the evening job did not run that day, the latest
 * before it within a week. Null in the firm's first season.
 */
export async function snapshotOn(
  db: Db,
  tenantId: string,
  kpi: string,
  day: string,
): Promise<number | null> {
  const [row] = await db
    .select({ value: kpiSnapshot.value })
    .from(kpiSnapshot)
    .where(
      and(
        eq(kpiSnapshot.tenantId, tenantId),
        eq(kpiSnapshot.kpi, kpi),
        lte(kpiSnapshot.snapshotDate, day),
        sql`${kpiSnapshot.snapshotDate} > ${day}::date - 7`,
        isNull(kpiSnapshot.deletedAt),
      ),
    )
    .orderBy(desc(kpiSnapshot.snapshotDate))
    .limit(1);
  return row ? Number(row.value) : null;
}

/** The latest snapshots of a KPI, newest first. */
export async function snapshotsOf(db: Db, tenantId: string, kpi: string, limit = 10) {
  const rows = await db
    .select({ day: kpiSnapshot.snapshotDate, value: kpiSnapshot.value })
    .from(kpiSnapshot)
    .where(
      and(
        eq(kpiSnapshot.tenantId, tenantId),
        eq(kpiSnapshot.kpi, kpi),
        isNull(kpiSnapshot.deletedAt),
      ),
    )
    .orderBy(desc(kpiSnapshot.snapshotDate))
    .limit(limit);
  return rows.map((r) => ({ day: r.day, value: Number(r.value) }));
}

/** Customers who clicked through to the review in the period (KPI 19 in the MVP). */
export async function reviewClicks(
  db: Db,
  tenantId: string,
  period: { from: string; to: string },
): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from survey
    where tenant_id = ${tenantId} and deleted_at is null
      and (review_link_clicked_at at time zone 'Europe/Stockholm')::date
          between ${period.from}::date and ${period.to}::date`);
  return row?.n ?? 0;
}

/** The firm's people and services, for a card's breakdown. */
export async function breakdownTargets(db: Db, tenantId: string) {
  const people = await db
    .select({ id: appUser.id, name: appUser.name })
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), isNull(appUser.deletedAt)))
    .orderBy(asc(appUser.name));
  const services = await db
    .select({ id: serviceType.id, name: serviceType.name })
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, tenantId), isNull(serviceType.deletedAt)))
    .orderBy(asc(serviceType.name));
  return { people, services };
}

/** The firm's settings, for the seasons of KPI 14. */
export async function firmSettings(db: Db, tenantId: string): Promise<unknown> {
  const [row] = await db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  return row?.settings ?? null;
}
