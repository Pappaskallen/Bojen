/**
 * The dashboard's figures (spec 9.1, byggplan step 7.1): the KPIs of the MVP (12.1), worked out
 * from the sums that the database's KPI views give for a period, and how each stands against
 * its target. Pure: the sums come in, the figures and colours come out.
 */
/** The KPIs of the MVP, by their number in spec 9.1. KPI 21–24 come with step 7.3. */
export const KPI_KEYS = [
  "revenue", // 1
  "revenuePerWorkDay", // 2
  "averageOrder", // 3
  "occupancy", // 4
  "billableShare", // 5
  "driveShare", // 6
  "visitsPerMarinaStop", // 7
  "noAccess", // 8
  "confirmation", // 9
  "refill", // 10
  "hoursToBooking", // 11
  "prebooking", // 14
  "csat", // 17
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

/** What the KPI views sum up for a period; minutes and öre throughout. */
export interface KpiTotals {
  /** Approved invoice bases, excluding VAT. */
  revenueOre: number;
  /** Days with at least one done visit. */
  workDays: number;
  /** Jobs with an approved invoice basis. */
  invoicedJobs: number;
  bookedMinutes: number;
  capacityMinutes: number;
  /** Labour on the approved invoice bases; a fixed price counts as the visit's planned time. */
  labourMinutes: number;
  driveMinutes: number;
  /** Planned time of the done visits. */
  onSiteMinutes: number;
  /** Done visits with a known place, and the distinct mechanic, place and day they make. */
  placeVisits: number;
  marinaStops: number;
  noAccessVisits: number;
  doneOrNoAccessVisits: number;
  checksSent: number;
  checksConfirmed: number;
  /** Times freed more than two hours ahead, and how many of them the waitlist filled. */
  freedSlots: number;
  refilledSlots: number;
  /** Hours from each job's creation to its first visit. */
  hoursToFirstVisit: number[];
  surveysAnswered: number;
  surveysHappy: number;
}

/** Prebooking (KPI 14) is measured over a season, not over the period. */
export interface Prebooking {
  season: SeasonWindow;
  bookedMinutes: number;
  capacityMinutes: number;
}

export type KpiValues = Record<KpiKey, number | null>;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const high = sorted[mid] ?? 0;
  return sorted.length % 2 ? high : ((sorted[mid - 1] ?? high) + high) / 2;
}

/** The figures, as shares from 0 to 1, öre and hours. Null where nothing is measured yet. */
export function computeKpis(t: KpiTotals, prebooking: Prebooking | null): KpiValues {
  return {
    revenue: t.revenueOre,
    revenuePerWorkDay: ratio(t.revenueOre, t.workDays),
    averageOrder: ratio(t.revenueOre, t.invoicedJobs),
    occupancy: ratio(t.bookedMinutes, t.capacityMinutes),
    billableShare: ratio(t.labourMinutes, t.capacityMinutes),
    driveShare: ratio(t.driveMinutes, t.driveMinutes + t.onSiteMinutes),
    visitsPerMarinaStop: ratio(t.placeVisits, t.marinaStops),
    noAccess: ratio(t.noAccessVisits, t.doneOrNoAccessVisits),
    confirmation: ratio(t.checksConfirmed, t.checksSent),
    refill: ratio(t.refilledSlots, t.freedSlots),
    hoursToBooking: median(t.hoursToFirstVisit),
    prebooking: prebooking ? ratio(prebooking.bookedMinutes, prebooking.capacityMinutes) : null,
    csat: ratio(t.surveysHappy, t.surveysAnswered),
  };
}

// --- Targets and colours (spec 9.2) -------------------------------------------------------

export interface KpiTarget {
  min?: number;
  max?: number;
}

/** The targets of spec 9.1; KPIs without a target get no colour. */
export const KPI_TARGETS: Record<KpiKey, KpiTarget | null> = {
  revenue: null,
  revenuePerWorkDay: { min: 900_000 },
  averageOrder: null,
  occupancy: { min: 0.85, max: 0.95 },
  billableShare: { min: 0.75 },
  driveShare: { max: 0.15 },
  visitsPerMarinaStop: { min: 2.5 },
  noAccess: { max: 0.02 },
  confirmation: { min: 0.85 },
  refill: { min: 0.5 },
  hoursToBooking: { max: 4 },
  prebooking: { min: 0.6 },
  csat: { min: 0.9 },
};

export type KpiLevel = "green" | "yellow" | "red";

/** Green when the target is met, yellow within 10 % of it, red when further off. */
export function kpiLevel(key: KpiKey, value: number | null): KpiLevel | null {
  const target = KPI_TARGETS[key];
  if (!target || value === null) return null;
  const { min, max } = target;
  if (min !== undefined && value < min) return value >= min * 0.9 ? "yellow" : "red";
  if (max !== undefined && value > max) return value <= max * 1.1 ? "yellow" : "red";
  return "green";
}

// --- Seasons (KPI 14) ----------------------------------------------------------------------

/** A season as month and day, the same every year; `to` is the last day. */
export interface Season {
  name: "spring" | "autumn";
  from: string;
  to: string;
}

export interface SeasonWindow {
  name: Season["name"];
  /** Stockholm dates, both included. */
  from: string;
  to: string;
}

/** Launches in spring and haul-outs in autumn, unless the firm has set its own. */
export const DEFAULT_SEASONS: readonly Season[] = [
  { name: "spring", from: "04-01", to: "06-15" },
  { name: "autumn", from: "09-01", to: "10-31" },
];

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The firm's seasons from `tenant.settings.kpi.seasons`, or the defaults. */
export function kpiSeasons(settings: unknown): Season[] {
  const kpi = (settings as { kpi?: { seasons?: unknown } } | null)?.kpi;
  const raw = Array.isArray(kpi?.seasons) ? (kpi.seasons as unknown[]) : [];
  const seasons = raw.flatMap((s): Season[] => {
    const r = s as Partial<Season> | null;
    return r &&
      (r.name === "spring" || r.name === "autumn") &&
      typeof r.from === "string" &&
      typeof r.to === "string" &&
      MONTH_DAY.test(r.from) &&
      MONTH_DAY.test(r.to) &&
      r.from < r.to
      ? [{ name: r.name, from: r.from, to: r.to }]
      : [];
  });
  return seasons.length > 0 ? seasons : [...DEFAULT_SEASONS];
}

/**
 * The season to fill: the next one that has not started yet (in May, the autumn; on
 * 1 March, the spring).
 */
export function nextSeason(today: string, seasons: readonly Season[]): SeasonWindow | null {
  const year = Number(today.slice(0, 4));
  const windows = [year, year + 1]
    .flatMap((y) =>
      seasons.map((s) => ({
        name: s.name,
        from: `${String(y)}-${s.from}`,
        to: `${String(y)}-${s.to}`,
      })),
    )
    .filter((w) => w.from > today)
    .sort((a, b) => a.from.localeCompare(b.from));
  return windows[0] ?? null;
}

/** The key a daily snapshot of KPI 14 is kept under, for the comparison with last year (KPI 15). */
export const prebookingSnapshotKey = (season: SeasonWindow["name"]) => `kpi14_prebooking_${season}`;
