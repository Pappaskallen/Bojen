import type { BookingWindow, LocalTime } from "../scheduling/availability";
import type { MarinaDayDiscount } from "../scheduling/suggest";

/**
 * The firm's booking settings, stored in `tenant.settings.booking`. Anything missing or
 * invalid falls back to the default, so a firm without settings can still take bookings.
 */
export interface BookingSettings {
  windows: BookingWindow[];
  bufferMinutes: number;
  maxExtraDriveMinutes: number;
  marinaDayDiscount: MarinaDayDiscount | null;
  /** Free cancellation and rescheduling until this many hours before the start (W6). */
  customerChangeCutoffHours: number;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  windows: [
    { start: "08:00", end: "12:00" },
    { start: "12:00", end: "16:00" },
    { start: "16:00", end: "19:00" },
  ],
  bufferMinutes: 15,
  maxExtraDriveMinutes: 45,
  marinaDayDiscount: null,
  customerChangeCutoffHours: 48,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function minutes(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : fallback;
}

function windows(value: unknown): BookingWindow[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const parsed: BookingWindow[] = [];
  for (const w of value) {
    if (!isRecord(w) || typeof w.start !== "string" || typeof w.end !== "string") return undefined;
    if (!TIME.test(w.start) || !TIME.test(w.end) || w.start >= w.end) return undefined;
    parsed.push({ start: w.start as LocalTime, end: w.end as LocalTime });
  }
  return parsed;
}

function discount(value: unknown): MarinaDayDiscount | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (value.kind === "waive_callout") return { kind: "waive_callout" };
  if (
    value.kind === "percent" &&
    typeof value.percent === "number" &&
    value.percent > 0 &&
    value.percent <= 100
  ) {
    return { kind: "percent", percent: value.percent };
  }
  return undefined;
}

/** Reads the booking part of `tenant.settings`. */
export function bookingSettings(tenantSettings: unknown): BookingSettings {
  const raw =
    isRecord(tenantSettings) && isRecord(tenantSettings.booking) ? tenantSettings.booking : {};
  const d = DEFAULT_BOOKING_SETTINGS;
  return {
    windows: windows(raw.windows) ?? d.windows,
    bufferMinutes: minutes(raw.bufferMinutes, d.bufferMinutes, 240),
    maxExtraDriveMinutes: minutes(raw.maxExtraDriveMinutes, d.maxExtraDriveMinutes, 600),
    marinaDayDiscount: discount(raw.marinaDayDiscount) ?? d.marinaDayDiscount,
    customerChangeCutoffHours: minutes(
      raw.customerChangeCutoffHours,
      d.customerChangeCutoffHours,
      720,
    ),
  };
}
