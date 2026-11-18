import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  change,
  DASHBOARD_TILES,
  formatChange,
  formatKpi,
  formatMinutes,
  KPI_SLUGS,
  kpiLevel,
  monthLabel,
  monthOf,
  monthPeriod,
  prebookingSnapshotKey,
  shiftMonth,
  sparkline,
  stockholmDate,
  weeksIn,
  yearBefore,
} from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import {
  dayRoute,
  dayVisits,
  kpiTotals,
  kpiValues,
  openTasks,
  revenueByWeek,
  reviewClicks,
  snapshotOn,
} from "@bojen/db";
import { db, maps, requireStaff } from "../../../lib/server";
import { AdminNav } from "../nav";
import { SignOutButton } from "../sign-out";
import { KpiCard, Level } from "./card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.dashboard.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const t = crm.dashboard;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** How many open matters the card lists (spec 9.2). */
const TODO_SHOWN = 3;

/**
 * The owner's dashboard in the phone (byggplan step 7.2, spec 9.2): today, the month's
 * revenue against last year, four KPIs with their colour against the target, the season's
 * prebooking, the customers and the open matters. Every card opens its details.
 */
export default async function OverviewPage({ searchParams }: Props) {
  const staff = await requireStaff("/oversikt");
  if (staff.role === "mechanic") redirect("/idag");
  const query = await searchParams;
  const now = new Date();
  const today = stockholmDate(now);
  const asked = first(query.manad);
  const month = asked && monthPeriod(asked) ? asked : monthOf(today);
  const period = monthPeriod(month) ?? { from: today, to: today };
  const tenantId = staff.context.tenantId;
  const d = db();

  const { values, season } = await kpiValues(d, tenantId, period, now);
  const lastYear = await kpiTotals(d, tenantId, yearBefore(period));
  const weeks = weeksIn(period);
  const bars = await revenueByWeek(d, tenantId, weeks);
  const seasonLastYear = season
    ? await snapshotOn(
        d,
        tenantId,
        prebookingSnapshotKey(season.name),
        yearBefore({ from: today, to: today }).from,
      )
    : null;
  const visits = await dayVisits(d, tenantId, staff.context.actor.id, today);
  const route = await dayRoute({ db: d, maps: maps() }, tenantId, visits, now).catch(() => null);
  const tasks = await openTasks(d, tenantId);
  const clicks = await reviewClicks(d, tenantId, period);

  const revenueChange = change(values.revenue, lastYear.revenueOre || null);
  const places = new Set(visits.flatMap((v) => (v.place ? [v.place.id] : []))).size;
  const confirmed = visits.filter((v) => v.status === "confirmed").length;
  const link = (key: keyof typeof KPI_SLUGS) => `/oversikt/${KPI_SLUGS[key]}?manad=${month}`;
  const prebooked = values.prebooking;

  return (
    <main className="booking crm dashboard">
      <AdminNav current="overview" />
      <header className="dashboard-head">
        <h1>{t.title}</h1>
        <nav className="month-pager" aria-label={t.month}>
          <Link href={`/oversikt?manad=${shiftMonth(month, -1)}`} aria-label={t.previousMonth}>
            ‹
          </Link>
          <span>{monthLabel(month)}</span>
          <Link href={`/oversikt?manad=${shiftMonth(month, 1)}`} aria-label={t.nextMonth}>
            ›
          </Link>
        </nav>
      </header>

      <section className="dash-card" aria-labelledby="dash-today">
        <h2 id="dash-today">{t.today}</h2>
        {visits.length === 0 ? (
          <p>{t.noJobsToday}</p>
        ) : (
          <>
            <p>{t.jobsToday(visits.length, places)}</p>
            <p>
              ✅ {t.confirmed(confirmed)}
              {route ? ` · 🚗 ${t.drive(formatMinutes(route.suggestedSeconds / 60))}` : ""}
            </p>
          </>
        )}
        <Link className="dash-action" href="/idag">
          {t.openRoute}
        </Link>
      </section>

      <Link className="dash-card dash-link" href={link("revenue")}>
        <h2>{t.revenueIn(monthLabel(month, false))}</h2>
        <p className="dash-big">{formatKpi("revenue", values.revenue)}</p>
        {revenueChange !== null ? (
          <p>{t.against(formatChange(revenueChange), monthLabel(shiftMonth(month, -12)))}</p>
        ) : null}
        <p className="sparkline" aria-hidden="true">
          {sparkline(bars.map((b) => b.ore))}{" "}
          <span>{t.weeks(weeks[0]?.week ?? 0, weeks.at(-1)?.week ?? 0)}</span>
        </p>
      </Link>

      <div className="dash-tiles">
        {DASHBOARD_TILES.map((key) => (
          <KpiCard
            key={key}
            href={link(key)}
            label={t.kpis[key]}
            value={formatKpi(key, values[key])}
            level={kpiLevel(key, values[key])}
          />
        ))}
      </div>

      {season ? (
        <Link className="dash-card dash-link" href={link("prebooking")}>
          <h2>
            {t.prebooked(`${t.seasons[season.name]} ${season.from.slice(0, 4)}`)}{" "}
            <Level level={kpiLevel("prebooking", prebooked)} />
          </h2>
          <div
            className="meter"
            role="meter"
            aria-label={t.kpis.prebooking}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((prebooked ?? 0) * 100)}
          >
            <span
              style={{ width: `${String(Math.min(100, Math.round((prebooked ?? 0) * 100)))}%` }}
            />
          </div>
          <p className="dash-big">{formatKpi("prebooking", prebooked)}</p>
          <p className="help">
            {seasonLastYear !== null
              ? t.sameDayLastYear(
                  formatKpi("prebooking", seasonLastYear),
                  prebooked !== null ? t.points(prebooked - seasonLastYear) : null,
                )
              : t.noSnapshotYet}
          </p>
        </Link>
      ) : null}

      <Link className="dash-card dash-link" href={link("csat")}>
        <h2>{t.customers}</h2>
        <p>
          ⭐ {t.csat(formatKpi("csat", values.csat))}{" "}
          <Level level={kpiLevel("csat", values.csat)} />
          {" · "}
          {t.reviewClicks(clicks)}
        </p>
      </Link>

      <section className="dash-card dash-todo" aria-labelledby="dash-todo">
        <h2 id="dash-todo">⚠ {t.todo(tasks.length)}</h2>
        {tasks.length === 0 ? (
          <p>{t.noTodo}</p>
        ) : (
          <ul aria-labelledby="dash-todo">
            {tasks.slice(0, TODO_SHOWN).map((task) => (
              <li key={task.id}>
                <Link href="/idag/arenden">{task.title}</Link>
              </li>
            ))}
          </ul>
        )}
        <Link className="dash-action" href="/idag/arenden">
          {t.allTasks}
        </Link>
      </section>
      <SignOutButton />
    </main>
  );
}
