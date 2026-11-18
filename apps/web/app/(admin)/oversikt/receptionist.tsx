import Link from "next/link";
import type { ReceptionistKpis } from "@bojen/core";
import { crm } from "@bojen/core/i18n/sv";

/** The receptionist's figures cover the last 30 days, whatever month the page shows. */
export const RECEPTIONIST_DAYS = 30;

export function receptionistWindow(now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - RECEPTIONIST_DAYS * 24 * 3_600_000), to: now };
}

export const percent = (share: number | null) =>
  share === null
    ? crm.dashboard.nothing
    : `${(share * 100).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} %`;

/** The receptionist's card on the dashboard (spec 9.2), opening the call list. */
export function ReceptionistCard({ stats }: { stats: ReceptionistKpis }) {
  const t = crm.dashboard;
  return (
    <Link className="dash-card dash-link" href="/oversikt/samtal">
      <h2>{t.receptionist}</h2>
      <p>📞 {t.callsAndBookings(stats.calls, stats.bookings)}</p>
      <p>🌙 {t.outsideHours(percent(stats.outsideHours))}</p>
      <p>↪ {t.transferredAndConversion(stats.transferred, percent(stats.conversion))}</p>
    </Link>
  );
}
