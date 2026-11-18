/**
 * The dashboard in the phone (byggplan step 7.2, spec 9.2): the month shown, the weeks in it,
 * the change against last year, and the figures as text. Pure.
 */
import { addDays, isoWeekday } from "../time";
import type { KpiKey } from "./kpi";

export interface Period {
  /** Stockholm dates, both included. */
  from: string;
  to: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2027-05" as its first and last day; null for anything else. */
export function monthPeriod(month: string): Period | null {
  const m = MONTH.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const next =
    m[2] === "12"
      ? `${String(year + 1)}-01-01`
      : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, "0")}-01`;
  return { from: `${month}-01`, to: addDays(next, -1) };
}

/** The month a Stockholm date falls in, as "2027-05". */
export const monthOf = (day: string) => day.slice(0, 7);

/** The month before or after, as "2027-04". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + by;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The same days a year earlier; 29 February becomes the 28th. */
export function yearBefore(p: Period): Period {
  const back = (d: string) => {
    const day = `${String(Number(d.slice(0, 4)) - 1)}${d.slice(4)}`;
    return day.endsWith("-02-29") ? day.replace("-02-29", "-02-28") : day;
  };
  return { from: back(p.from), to: back(p.to) };
}

/** The change from `before` to `now` as a share; null when there is nothing to compare with. */
export function change(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return (now - before) / before;
}

/** The ISO week number of a date. */
export function isoWeek(day: string): number {
  // The Thursday of the same week decides the year the week belongs to.
  const thursday = addDays(day, 4 - isoWeekday(day));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  let days = 0;
  for (let d = jan1; d < thursday; d = addDays(d, 1)) days += 1;
  return Math.floor(days / 7) + 1;
}

export interface Week extends Period {
  week: number;
}

/** The ISO weeks that touch the period, cut to it. */
export function weeksIn(p: Period): Week[] {
  const weeks: Week[] = [];
  let from = p.from;
  while (from <= p.to) {
    const sunday = addDays(from, 7 - isoWeekday(from));
    const to = sunday < p.to ? sunday : p.to;
    weeks.push({ week: isoWeek(from), from, to });
    from = addDays(to, 1);
  }
  return weeks;
}

/** The last `count` whole ISO weeks up to and including the one `day` is in. */
export function lastWeeks(day: string, count: number): Week[] {
  const monday = addDays(day, 1 - isoWeekday(day));
  return Array.from({ length: count }, (_, i) => {
    const from = addDays(monday, -7 * (count - 1 - i));
    return { week: isoWeek(from), from, to: addDays(from, 6) };
  });
}

const BARS = "▁▂▃▄▅▆▇█";

/** Values as a row of bars, highest = █; an empty week is the lowest bar. */
export function sparkline(values: readonly (number | null)[]): string {
  const known = values.filter((v): v is number => v !== null);
  const top = Math.max(0, ...known);
  return values
    .map((v) =>
      v === null || top === 0 ? BARS[0] : BARS[Math.round((v / top) * (BARS.length - 1))],
    )
    .join("");
}

const number = (v: number, digits: number) =>
  v.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** A KPI as the dashboard shows it; "–" when it is not measured yet. */
export function formatKpi(key: KpiKey, value: number | null): string {
  if (value === null) return "–";
  switch (key) {
    case "revenue":
    case "revenuePerWorkDay":
    case "averageOrder":
      return `${number(Math.round(value / 100), 0)} kr`;
    case "visitsPerMarinaStop":
      return number(value, 1);
    case "hoursToBooking":
      return `${number(value, 1)} h`;
    case "noAccess":
      return `${number(value * 100, 1)} %`;
    default:
      return `${number(value * 100, 0)} %`;
  }
}

/** A change as "▲ 12 %" or "▼ 3 %". */
export function formatChange(share: number): string {
  return `${share >= 0 ? "▲" : "▼"} ${number(Math.abs(share) * 100, 0)} %`;
}

/** Minutes as "1 h 10 min", "45 min" or "2 h". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${String(m)} min`;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

/** The four small cards in the middle of the sketch. */
export const DASHBOARD_TILES = [
  "occupancy",
  "driveShare",
  "visitsPerMarinaStop",
  "noAccess",
] as const satisfies readonly KpiKey[];

/** The KPIs that have a page of their own behind their card. */
export const DETAIL_KPIS = [
  "revenue",
  ...DASHBOARD_TILES,
  "prebooking",
  "csat",
] as const satisfies readonly KpiKey[];
export type DetailKpi = (typeof DETAIL_KPIS)[number];

/** The card's path segment, Swedish as the rest of the address. */
export const KPI_SLUGS: Record<DetailKpi, string> = {
  revenue: "intakt",
  occupancy: "belaggning",
  driveShare: "korandel",
  visitsPerMarinaStop: "jobb-per-marina",
  noAccess: "ej-tillganglig",
  prebooking: "forbokning",
  csat: "csat",
};

export function kpiFromSlug(slug: string): DetailKpi | null {
  const found = (Object.entries(KPI_SLUGS) as [DetailKpi, string][]).find(([, s]) => s === slug);
  return found ? found[0] : null;
}

/** "2027-05" as "maj 2027", or just "maj". */
export function monthLabel(month: string, withYear = true): string {
  const name = new Intl.DateTimeFormat("sv-SE", { month: "long", timeZone: "UTC" }).format(
    new Date(`${month}-15T12:00:00Z`),
  );
  return withYear ? `${name} ${month.slice(0, 4)}` : name;
}
