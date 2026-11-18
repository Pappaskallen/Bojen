import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  computeKpis,
  formatKpi,
  KPI_TARGETS,
  kpiFromSlug,
  kpiLevel,
  kpiSeasons,
  lastWeeks,
  monthLabel,
  monthOf,
  monthPeriod,
  nextSeason,
  prebookingSnapshotKey,
  stockholmDate,
  type DetailKpi,
} from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import {
  breakdownTargets,
  kpiTotals,
  prebooking,
  snapshotsOf,
  firmSettings,
  type KpiFilter,
} from "@bojen/db";
import { db, requireStaff } from "../../../../lib/server";
import { AdminNav } from "../../nav";
import { Level } from "../card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.dashboard.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = {
  params: Promise<{ kpi: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const t = crm.dashboard;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Weeks in the trend. */
const TREND_WEEKS = 8;

function targetText(key: DetailKpi): string | null {
  const target = KPI_TARGETS[key];
  if (!target) return null;
  const { min, max } = target;
  if (min !== undefined && max !== undefined)
    return `${formatKpi(key, min)}–${formatKpi(key, max)}`;
  if (min !== undefined) return `≥ ${formatKpi(key, min)}`;
  return max !== undefined ? `≤ ${formatKpi(key, max)}` : null;
}

interface Row {
  label: string;
  value: number | null;
}

function Rows({ title, rows, kpi }: { title: string; rows: Row[]; kpi: DetailKpi }) {
  return (
    <section className="dash-card">
      <h2>{title}</h2>
      <table className="kpi-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>
                {formatKpi(kpi, r.value)} <Level level={kpiLevel(kpi, r.value)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * A dashboard card's details (spec 9.2): the trend per week and the month broken down per
 * mechanic and per service. Prebooking is per season, so it shows its snapshots instead.
 */
export default async function KpiPage({ params, searchParams }: Props) {
  const { kpi: slug } = await params;
  const key = kpiFromSlug(slug);
  if (!key) notFound();
  const staff = await requireStaff(`/oversikt/${slug}`);
  if (staff.role === "mechanic") redirect("/idag");
  const query = await searchParams;
  const now = new Date();
  const today = stockholmDate(now);
  const asked = first(query.manad);
  const month = asked && monthPeriod(asked) ? asked : monthOf(today);
  const period = monthPeriod(month) ?? { from: today, to: today };
  const tenantId = staff.context.tenantId;
  const d = db();
  const { people, services } = await breakdownTargets(d, tenantId);

  let sections: { title: string; rows: Row[] }[];
  if (key === "prebooking") {
    const season = nextSeason(today, kpiSeasons(await firmSettings(d, tenantId)));
    const value = async (mechanicId?: string) => {
      if (!season) return null;
      const p = await prebooking(d, tenantId, season, { mechanicId });
      return p.capacityMinutes > 0 ? p.bookedMinutes / p.capacityMinutes : null;
    };
    const snapshots = season
      ? await snapshotsOf(d, tenantId, prebookingSnapshotKey(season.name), TREND_WEEKS)
      : [];
    sections = [
      { title: t.snapshots, rows: snapshots.map((s) => ({ label: s.day, value: s.value })) },
      {
        title: t.perMechanic,
        rows: await Promise.all(
          people.map(async (p) => ({ label: p.name, value: await value(p.id) })),
        ),
      },
    ];
  } else {
    const valueFor = async (f: KpiFilter) =>
      computeKpis(await kpiTotals(d, tenantId, f), null)[key];
    const weeks = lastWeeks(period.to < today ? period.to : today, TREND_WEEKS);
    sections = [
      {
        title: t.perWeek,
        rows: await Promise.all(
          weeks.map(async (w) => ({ label: t.week(w.week), value: await valueFor(w) })),
        ),
      },
      {
        title: `${t.perMechanic}, ${monthLabel(month)}`,
        rows: await Promise.all(
          people.map(async (p) => ({
            label: p.name,
            value: await valueFor({ ...period, mechanicId: p.id }),
          })),
        ),
      },
      {
        title: `${t.perService}, ${monthLabel(month)}`,
        rows: await Promise.all(
          services.map(async (s) => ({
            label: s.name,
            value: await valueFor({ ...period, serviceTypeId: s.id }),
          })),
        ),
      },
    ];
  }
  const target = targetText(key);

  return (
    <main className="booking crm dashboard">
      <AdminNav current="overview" />
      <p>
        <Link href={`/oversikt?manad=${month}`}>{t.back}</Link>
      </p>
      <h1>{t.kpis[key]}</h1>
      {target ? <p className="help">{t.target(target)}</p> : null}
      {sections.map((s) => (
        <Rows key={s.title} title={s.title} rows={s.rows} kpi={key} />
      ))}
    </main>
  );
}
