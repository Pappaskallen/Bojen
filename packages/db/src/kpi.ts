/**
 * The dashboard's sums (byggplan step 7.1, spec 9.1): read from the KPI views of migration
 * 0029 for one firm and a period, for `computeKpis` in core. The views are refreshed by the
 * worker every 15 minutes, and KPI 14 gets a snapshot a day for next year's comparison.
 */
import {
  computeKpis,
  kpiSeasons,
  nextSeason,
  prebookingSnapshotKey,
  stockholmDate,
  type KpiTotals,
  type KpiValues,
  type Prebooking,
  type SeasonWindow,
} from "@bojen/core";
import { eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client";
import { kpiSnapshot, tenant } from "./schema";

type Db = Pick<Database, "select" | "insert" | "execute">;

/** The visit statuses that hold the mechanic's time (KPI 4 and 14). */
const BOOKED = sql`('pending_approval', 'booked', 'confirmed', 'unconfirmed', 'in_progress', 'done', 'no_access')`;
/** Availability checks that went out (KPI 9). */
const CHECKED = sql`('pending', 'confirmed', 'declined', 'change_requested', 'no_reply')`;

export interface KpiFilter {
  /** Stockholm dates, both included. */
  from: string;
  to: string;
  mechanicId?: string | undefined;
  serviceTypeId?: string | undefined;
}

/** Brings the KPI views up to date. Run by the worker; tests call it after adding rows. */
export async function refreshKpiViews(db: Pick<Database, "execute">): Promise<void> {
  await db.execute(sql`select kpi.refresh()`);
}

function where(tenantId: string, f: KpiFilter, opts: { mechanic?: SQL; service?: boolean } = {}) {
  const parts = [sql`tenant_id = ${tenantId}`, sql`day between ${f.from}::date and ${f.to}::date`];
  if (f.mechanicId) parts.push(sql`${opts.mechanic ?? sql`mechanic_id`} = ${f.mechanicId}`);
  if (f.serviceTypeId && opts.service !== false)
    parts.push(sql`service_type_id = ${f.serviceTypeId}`);
  return sql.join(parts, sql` and `);
}

const num = (v: unknown) => Number(v ?? 0);

/** The sums of the period, as `computeKpis` wants them. */
export async function kpiTotals(db: Db, tenantId: string, f: KpiFilter): Promise<KpiTotals> {
  const [visits] = await db.execute<Record<string, string | null>>(sql`
    select
      count(distinct day) filter (where status = 'done') as work_days,
      coalesce(sum(planned_minutes) filter (where status in ${BOOKED}), 0) as booked_minutes,
      coalesce(sum(drive_minutes) filter (where status in ('done', 'no_access')), 0) as drive_minutes,
      coalesce(sum(planned_minutes) filter (where status = 'done'), 0) as on_site_minutes,
      count(*) filter (where status = 'done' and location_id is not null and mechanic_id is not null) as place_visits,
      count(distinct (mechanic_id, location_id, day))
        filter (where status = 'done' and location_id is not null and mechanic_id is not null) as marina_stops,
      count(*) filter (where status = 'no_access') as no_access,
      count(*) filter (where status in ('done', 'no_access')) as done_or_no_access,
      count(*) filter (where availability_status in ${CHECKED}) as checks_sent,
      count(*) filter (where availability_status = 'confirmed') as checks_confirmed
    from kpi.visit_fact where ${where(tenantId, f)}`);
  const [reports] = await db.execute<Record<string, string | null>>(sql`
    select coalesce(sum(net_ore), 0) as revenue_ore,
           count(distinct job_id) as invoiced_jobs,
           coalesce(sum(labour_minutes), 0) as labour_minutes
    from kpi.report_fact where ${where(tenantId, f)}`);
  // Capacity has no service: a filter on service leaves it whole.
  const [capacity] = await db.execute<{ minutes: string | null }>(sql`
    select coalesce(sum(capacity_minutes), 0) as minutes
    from kpi.capacity_day where ${where(tenantId, f, { mechanic: sql`user_id`, service: false })}`);
  const [freed] = await db.execute<{ freed: string; refilled: string }>(sql`
    select count(*) as freed, count(*) filter (where refilled) as refilled
    from kpi.freed_slot where ${where(tenantId, f)}`);
  const leads = await db.execute<{ hours: string }>(sql`
    select hours_to_first_visit as hours from kpi.job_fact where ${where(tenantId, f)}`);
  const [surveys] = await db.execute<{ answered: string; happy: string }>(sql`
    select count(s.score) as answered, count(*) filter (where s.score >= 4) as happy
    from survey s
    join visit v on v.tenant_id = s.tenant_id and v.id = s.visit_id
    join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
    where s.tenant_id = ${tenantId} and s.deleted_at is null and s.score is not null
      and (s.answered_at at time zone 'Europe/Stockholm')::date between ${f.from}::date and ${f.to}::date
      ${f.mechanicId ? sql`and v.mechanic_id = ${f.mechanicId}` : sql``}
      ${f.serviceTypeId ? sql`and j.service_type_id = ${f.serviceTypeId}` : sql``}`);

  return {
    revenueOre: num(reports?.revenue_ore),
    workDays: num(visits?.work_days),
    invoicedJobs: num(reports?.invoiced_jobs),
    bookedMinutes: num(visits?.booked_minutes),
    capacityMinutes: num(capacity?.minutes),
    labourMinutes: num(reports?.labour_minutes),
    driveMinutes: num(visits?.drive_minutes),
    onSiteMinutes: num(visits?.on_site_minutes),
    placeVisits: num(visits?.place_visits),
    marinaStops: num(visits?.marina_stops),
    noAccessVisits: num(visits?.no_access),
    doneOrNoAccessVisits: num(visits?.done_or_no_access),
    checksSent: num(visits?.checks_sent),
    checksConfirmed: num(visits?.checks_confirmed),
    freedSlots: num(freed?.freed),
    refilledSlots: num(freed?.refilled),
    hoursToFirstVisit: [...leads].map((r) => Number(r.hours)),
    surveysAnswered: num(surveys?.answered),
    surveysHappy: num(surveys?.happy),
  };
}

async function seasonsOf(db: Db, tenantId: string) {
  const [t] = await db
    .select({ settings: tenant.settings })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  return kpiSeasons(t?.settings);
}

/** Booked time against capacity in a season (KPI 14), as it stands now. */
export async function prebooking(
  db: Db,
  tenantId: string,
  season: SeasonWindow,
  filter: Pick<KpiFilter, "mechanicId"> = {},
): Promise<Prebooking> {
  const f = { from: season.from, to: season.to, mechanicId: filter.mechanicId };
  const [booked] = await db.execute<{ minutes: string | null }>(sql`
    select coalesce(sum(planned_minutes), 0) as minutes
    from kpi.visit_fact where ${where(tenantId, f)} and status in ${BOOKED}`);
  const [capacity] = await db.execute<{ minutes: string | null }>(sql`
    select coalesce(sum(capacity_minutes), 0) as minutes
    from kpi.capacity_day where ${where(tenantId, f, { mechanic: sql`user_id`, service: false })}`);
  return { season, bookedMinutes: num(booked?.minutes), capacityMinutes: num(capacity?.minutes) };
}

/** The dashboard's figures for a period, with KPI 14 for the next season from `now`. */
export async function kpiValues(
  db: Db,
  tenantId: string,
  f: KpiFilter,
  now: Date,
): Promise<{ values: KpiValues; season: SeasonWindow | null }> {
  const season = nextSeason(stockholmDate(now), await seasonsOf(db, tenantId));
  const totals = await kpiTotals(db, tenantId, f);
  const pre = season ? await prebooking(db, tenantId, season, f) : null;
  return { values: computeKpis(totals, pre), season };
}

/**
 * Today's snapshot of KPI 14 for every firm, kept for the comparison with the same day next
 * year (KPI 15). Run once a day; a second run the same day writes the newer value.
 */
export async function snapshotKpis(db: Db, now: Date): Promise<number> {
  const today = stockholmDate(now);
  const firms = await db.select({ id: tenant.id, settings: tenant.settings }).from(tenant);
  let written = 0;
  for (const firm of firms) {
    const season = nextSeason(today, kpiSeasons(firm.settings));
    if (!season) continue;
    const p = await prebooking(db, firm.id, season);
    if (p.capacityMinutes === 0) continue;
    const value = (p.bookedMinutes / p.capacityMinutes).toFixed(4);
    await db
      .insert(kpiSnapshot)
      .values({
        tenantId: firm.id,
        snapshotDate: today,
        kpi: prebookingSnapshotKey(season.name),
        value,
      })
      .onConflictDoUpdate({
        target: [kpiSnapshot.tenantId, kpiSnapshot.kpi, kpiSnapshot.snapshotDate],
        set: { value, updatedAt: now },
      });
    written += 1;
  }
  return written;
}

export const REFRESH_KPIS_TASK = "refresh_kpis";
export const SNAPSHOT_KPIS_TASK = "snapshot_kpis";

/**
 * Graphile Worker's crontab (UTC): the views every 15 minutes (spec 9.1), and the snapshot
 * late each evening, still the same Stockholm day in summer and winter.
 */
export const KPI_CRONTAB = [
  `*/15 * * * * ${REFRESH_KPIS_TASK}`,
  `30 21 * * * ${SNAPSHOT_KPIS_TASK}`,
].join("\n");
