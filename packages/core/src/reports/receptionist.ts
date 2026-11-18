/**
 * The receptionist's figures (spec 9.1 KPI 21–24, byggplan step 7.3): calls without spam,
 * how many of those who wanted a time got one, how many were put through, and how many came
 * outside office hours. Pure.
 */
import { withinWindows } from "../voice/escalation";
import type { OnCallWindow } from "../voice/settings";
import type { CallIntent, CallOutcome } from "../voice/summarize";
import type { KpiTarget } from "./kpi";

export interface CallRecord {
  startedAt: Date;
  outcome: CallOutcome | null;
  intent: CallIntent | null;
}

export interface ReceptionistKpis {
  /** KPI 21: every call but spam. */
  calls: number;
  bookings: number;
  transferred: number;
  /** KPI 22: booked of those who wanted a time or had an emergency. */
  conversion: number | null;
  /** KPI 23 */
  transferShare: number | null;
  /** KPI 24 */
  outsideHours: number | null;
}

export const RECEPTIONIST_TARGETS: Record<
  "conversion" | "transferShare" | "outsideHours",
  KpiTarget | null
> = {
  conversion: { min: 0.6 },
  transferShare: { max: 0.15 },
  // Shows what the AI is worth; no target.
  outsideHours: null,
};

const share = (a: number, b: number) => (b > 0 ? a / b : null);

export function receptionistKpis(
  calls: readonly CallRecord[],
  officeHours: readonly OnCallWindow[],
): ReceptionistKpis {
  const real = calls.filter((c) => c.outcome !== "spam");
  const bookings = real.filter((c) => c.outcome === "booked").length;
  // A booked call wanted a time, whatever the agent noted; so the share is never above 1.
  const wanted = real.filter(
    (c) => c.outcome === "booked" || c.intent === "book" || c.intent === "emergency",
  ).length;
  const transferred = real.filter((c) => c.outcome === "transferred").length;
  const outside = real.filter((c) => !withinWindows(officeHours, c.startedAt)).length;
  return {
    calls: real.length,
    bookings,
    transferred,
    conversion: share(bookings, wanted),
    transferShare: share(transferred, real.length),
    outsideHours: share(outside, real.length),
  };
}

/** The outcomes the call list can be filtered on, with "none" for calls still without one. */
export const CALL_FILTERS = ["booked", "message", "transferred", "spam", "none"] as const;
export type CallFilter = (typeof CALL_FILTERS)[number];

export const callFilter = (v: string | undefined): CallFilter | null =>
  CALL_FILTERS.find((f) => f === v) ?? null;
