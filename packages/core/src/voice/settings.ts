/**
 * The firm's settings for the receptionist (spec 8.2 and 8.4), stored in
 * `tenant.settings.receptionist`. Anything missing falls back to the default, so a firm can
 * take calls before it has set everything.
 */

/**
 * A stretch of the week when a call can be put through to a person (spec 8.4 "jourtider"):
 * ISO weekdays (1 Monday … 7 Sunday) and Stockholm clock times. A window that ends before it
 * starts runs past midnight into the next day, for example 17:00–07:00.
 */
export interface OnCallWindow {
  days: number[];
  from: string;
  to: string;
}

export interface OnCallSettings {
  windows: OnCallWindow[];
  /** The mechanics on call, in the order they are tried (`app_user.id`). Empty: all staff. */
  mechanicIds: string[];
  /** Whether emergencies on Saturdays and Sundays are offered at all (spec 8.4). */
  weekendEmergency: boolean;
}

export interface ReceptionistSettings {
  /** The assistant's name in the first line. */
  assistantName: string;
  /** "Hej och välkommen till …", said before the rest of the first line. */
  greeting: string | null;
  /** Where the firm goes, said as is, for example "Värmdö, Nacka och Stockholms skärgård". */
  serviceArea: string;
  /** Places the firm does not go to, for example "Arholma". */
  notServed: string[];
  /** When the phone is answered by people, and when there is someone on call. */
  openingHours: string;
  onCallHours: string;
  /** When a message gets an answer, for example "inom 30 minuter". */
  answerPromise: string;
  onCall: OnCallSettings;
  /** Seconds the mechanic's phone rings with the whisper before the agent takes a message. */
  transferSeconds: number;
  /** Minutes an urgent message waits for a mechanic before the next one is told (spec 8.4). */
  escalateAfterMinutes: number;
  /** Whose mobile takes the calls when the agent is down (K10); null: the owner's. */
  fallbackUserId: string | null;
}

export const DEFAULT_RECEPTIONIST: ReceptionistSettings = {
  assistantName: "Bojen",
  greeting: null,
  serviceArea: "Stockholms skärgård",
  notServed: [],
  openingHours: "vardagar 07–17",
  onCallHours: "ingen jour",
  answerPromise: "nästa vardag före klockan tio",
  onCall: { windows: [], mechanicIds: [], weekendEmergency: false },
  transferSeconds: 20,
  escalateAfterMinutes: 30,
  fallbackUserId: null,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
const int = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function window(v: unknown): OnCallWindow | null {
  if (!isRecord(v) || !Array.isArray(v.days)) return null;
  const days = [...new Set(v.days)].filter(
    (d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7,
  );
  const from = typeof v.from === "string" && CLOCK.test(v.from) ? v.from : null;
  const to = typeof v.to === "string" && CLOCK.test(v.to) ? v.to : null;
  if (days.length === 0 || !from || !to || from === to) return null;
  return { days: days.sort(), from, to };
}

function onCall(v: unknown): OnCallSettings {
  if (!isRecord(v)) return DEFAULT_RECEPTIONIST.onCall;
  return {
    windows: Array.isArray(v.windows)
      ? v.windows.map(window).filter((w): w is OnCallWindow => w !== null).slice(0, 14)
      : [],
    mechanicIds: Array.isArray(v.mechanicIds)
      ? v.mechanicIds.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, 10)
      : [],
    weekendEmergency: v.weekendEmergency === true,
  };
}

const DAY_NAMES = ["", "mån", "tis", "ons", "tor", "fre", "lör", "sön"];
const hour = (hhmm: string) => (hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : hhmm);

/** "mån–fre 17–22, lör–sön 09–17" for the prompt, from the windows. */
export function describeOnCall(windows: readonly OnCallWindow[]): string {
  if (windows.length === 0) return DEFAULT_RECEPTIONIST.onCallHours;
  return windows
    .map((w) => {
      const first = w.days[0] ?? 1;
      const last = w.days[w.days.length - 1] ?? first;
      const run = last - first + 1 === w.days.length && w.days.length > 2;
      const days = run
        ? `${DAY_NAMES[first] ?? ""}–${DAY_NAMES[last] ?? ""}`
        : w.days.map((d) => DAY_NAMES[d] ?? "").join(", ");
      return `${days} ${hour(w.from)}–${hour(w.to)}`;
    })
    .join(", ");
}

/** Reads the receptionist part of `tenant.settings`. */
export function receptionistSettings(tenantSettings: unknown): ReceptionistSettings {
  const raw =
    isRecord(tenantSettings) && isRecord(tenantSettings.receptionist)
      ? tenantSettings.receptionist
      : {};
  const d = DEFAULT_RECEPTIONIST;
  const call = onCall(raw.onCall);
  return {
    assistantName: str(raw.assistantName, d.assistantName, 40),
    greeting: typeof raw.greeting === "string" && raw.greeting.trim() ? raw.greeting.trim() : null,
    serviceArea: str(raw.serviceArea, d.serviceArea),
    notServed: Array.isArray(raw.notServed)
      ? raw.notServed.filter((x): x is string => typeof x === "string").slice(0, 20)
      : d.notServed,
    openingHours: str(raw.openingHours, d.openingHours),
    // The firm's own words win; else the windows are said as they are.
    onCallHours: str(raw.onCallHours, describeOnCall(call.windows)),
    answerPromise: str(raw.answerPromise, d.answerPromise),
    onCall: call,
    transferSeconds: int(raw.transferSeconds, d.transferSeconds, 10, 60),
    escalateAfterMinutes: int(raw.escalateAfterMinutes, d.escalateAfterMinutes, 5, 240),
    fallbackUserId:
      typeof raw.fallbackUserId === "string" && UUID.test(raw.fallbackUserId)
        ? raw.fallbackUserId
        : null,
  };
}
