/**
 * The firm's settings for the receptionist (spec 8.2 and 8.4), stored in
 * `tenant.settings.receptionist`. Anything missing falls back to the default, so a firm can
 * take calls before it has set everything.
 */

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
}

export const DEFAULT_RECEPTIONIST: ReceptionistSettings = {
  assistantName: "Bojen",
  greeting: null,
  serviceArea: "Stockholms skärgård",
  notServed: [],
  openingHours: "vardagar 07–17",
  onCallHours: "ingen jour",
  answerPromise: "nästa vardag före klockan tio",
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;

/** Reads the receptionist part of `tenant.settings`. */
export function receptionistSettings(tenantSettings: unknown): ReceptionistSettings {
  const raw =
    isRecord(tenantSettings) && isRecord(tenantSettings.receptionist)
      ? tenantSettings.receptionist
      : {};
  const d = DEFAULT_RECEPTIONIST;
  return {
    assistantName: str(raw.assistantName, d.assistantName, 40),
    greeting: typeof raw.greeting === "string" && raw.greeting.trim() ? raw.greeting.trim() : null,
    serviceArea: str(raw.serviceArea, d.serviceArea),
    notServed: Array.isArray(raw.notServed)
      ? raw.notServed.filter((x): x is string => typeof x === "string").slice(0, 20)
      : d.notServed,
    openingHours: str(raw.openingHours, d.openingHours),
    onCallHours: str(raw.onCallHours, d.onCallHours),
    answerPromise: str(raw.answerPromise, d.answerPromise),
  };
}
