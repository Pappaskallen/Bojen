import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CALL_FILTERS,
  callFilter,
  formatPhone,
  levelAgainst,
  RECEPTIONIST_TARGETS,
} from "@bojen/core";
import { crm, sv } from "@bojen/core/i18n/sv";
import { callList, receptionistStats } from "@bojen/db";
import { db, requireStaff } from "../../../../lib/server";
import { AdminNav } from "../../nav";
import { KpiCard } from "../card";
import { percent, receptionistWindow } from "../receptionist";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${crm.dashboard.calls.title} – ${sv.app.name}`,
  robots: "noindex",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const t = crm.dashboard.calls;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const time = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The receptionist's statistics (byggplan step 7.3, KPI 21–24) for the last 30 days, and the
 * calls, which can be filtered on outcome.
 */
export default async function CallsPage({ searchParams }: Props) {
  const staff = await requireStaff("/oversikt/samtal");
  if (staff.role === "mechanic") redirect("/idag");
  const filter = callFilter(first((await searchParams).utfall));
  const tenantId = staff.context.tenantId;
  const { from, to } = receptionistWindow(new Date());
  const stats = await receptionistStats(db(), tenantId, from, to);
  const calls = await callList(db(), tenantId, filter);

  return (
    <main className="booking crm dashboard">
      <AdminNav current="overview" />
      <p>
        <Link href="/oversikt">{crm.dashboard.back}</Link>
      </p>
      <h1>{t.title}</h1>
      <p className="help">{t.period}</p>
      <div className="dash-tiles">
        <KpiCard
          href="/oversikt/samtal"
          label={t.kpis.calls}
          value={String(stats.calls)}
          level={null}
        />
        <KpiCard
          href="/oversikt/samtal?utfall=booked"
          label={t.kpis.conversion}
          value={percent(stats.conversion)}
          level={levelAgainst(RECEPTIONIST_TARGETS.conversion, stats.conversion)}
        />
        <KpiCard
          href="/oversikt/samtal?utfall=transferred"
          label={t.kpis.transferShare}
          value={percent(stats.transferShare)}
          level={levelAgainst(RECEPTIONIST_TARGETS.transferShare, stats.transferShare)}
        />
        <KpiCard
          href="/oversikt/samtal"
          label={t.kpis.outsideHours}
          value={percent(stats.outsideHours)}
          level={null}
        />
      </div>

      <nav className="call-filters" aria-label={t.filter}>
        {[null, ...CALL_FILTERS].map((f) => {
          const label = f ? t.filters[f] : t.all;
          return f === filter ? (
            <span key={label} aria-current="page">
              {label}
            </span>
          ) : (
            <Link key={label} href={f ? `/oversikt/samtal?utfall=${f}` : "/oversikt/samtal"}>
              {label}
            </Link>
          );
        })}
      </nav>

      {calls.length === 0 ? (
        <p>{t.none}</p>
      ) : (
        <ul className="call-list" aria-label={t.title}>
          {calls.map((c) => (
            <li key={c.id}>
              <p className="call-head">
                <span>{time.format(c.startedAt)}</span>{" "}
                <strong>
                  {c.customer ?? (c.callerNumber ? formatPhone(c.callerNumber) : t.unknownCaller)}
                </strong>
              </p>
              <p className="help">
                {c.outcome ? (t.outcome[c.outcome] ?? c.outcome) : t.noOutcome}
                {c.intent ? ` · ${t.intent[c.intent] ?? c.intent}` : ""}
              </p>
              {c.summary ? <p className="call-summary">{c.summary}</p> : null}
              {c.customerId ? (
                <Link href={`/kunder/${c.customerId}`}>{crm.nav.customers} →</Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
