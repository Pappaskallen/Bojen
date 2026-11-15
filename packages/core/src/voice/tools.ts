/**
 * The receptionist's tools (byggplan step 6.1, spec 8.2): their names and input schemas for
 * the model, the call's short-lived token, and the control question before sensitive changes
 * (spec 8.3 point 4). Pure; the tools themselves run in packages/db behind
 * apps/web/app/api/voice-tools.
 *
 * No tool returns access codes, key locations or addresses: the answers are built from
 * allow-lists (`AgentCustomer` and the like), so a manipulated model has nothing to read out.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const VOICE_TOOL_NAMES = [
  "hitta_kund",
  "bekrafta_kund",
  "foresla_tider",
  "skapa_bokning",
  "hamta_bokningar",
  "omboka_bokning",
  "avboka_bokning",
  "skicka_lank",
  "satt_vantelista",
  "koppla_till_mekaniker",
  "skapa_meddelande",
  "stoppa_inspelning",
  "avsluta_samtal",
] as const;
export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];

export const isVoiceTool = (name: string): name is VoiceToolName =>
  (VOICE_TOOL_NAMES as readonly string[]).includes(name);

type Schema = Record<string, unknown>;
const str = (description: string): Schema => ({ type: "string", description });
const obj = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/** The tools as the model sees them (Claude tool use), with descriptions in English. */
export const VOICE_TOOLS: { name: VoiceToolName; description: string; input_schema: Schema }[] = [
  {
    name: "hitta_kund",
    description:
      "Look up a customer by the mobile number the caller gives, when the call's own number is hidden or belongs to someone else. Returns only whether the number is known and the first name until bekrafta_kund succeeds.",
    input_schema: obj({ telefon: str("Mobile number as the caller says it") }, ["telefon"]),
  },
  {
    name: "bekrafta_kund",
    description:
      "The control question: pass what the caller said about their boat's name, model or marina. Required before omboka_bokning and avboka_bokning, and before a customer found by another number is shown in full.",
    input_schema: obj({ svar: str("The caller's words, as said") }, ["svar"]),
  },
  {
    name: "foresla_tider",
    description:
      "Up to three free times for a service at a place, best first, with marina day and discount. Use the same engine as the web booking.",
    input_schema: obj(
      {
        tjanst_id: str("Service id from the firm's service list"),
        plats_id: str("A known place's id (from the customer context or the firm's places)"),
        plats_namn: str("A marina or club named by the caller, when there is no id"),
        adress: str("A street address, when the boat is at home or at a private dock"),
        lage: {
          type: "string",
          enum: ["water", "land", "indoor"],
          description: "Where the boat is",
        },
        andras_datum: str("Launch or haul-out date YYYY-MM-DD, if it changes soon"),
        tidigast: str("Earliest date YYYY-MM-DD"),
      },
      ["tjanst_id", "lage"],
    ),
  },
  {
    name: "skapa_bokning",
    description:
      "Book a time from foresla_tider after the caller has confirmed service, day and window. Creates the customer and boat when they are new. Never pass codes.",
    input_schema: obj(
      {
        tid_id: str("The id of the chosen time from foresla_tider"),
        namn: str("Caller's name, for a new customer"),
        bat_id: str("Known boat id, if it is one of the customer's boats"),
        bat_marke: str("Boat make, for a new boat"),
        bat_modell: str("Boat model, for a new boat"),
        motor_marke: str("Engine make"),
        motor_modell: str("Engine model"),
        beskrivning: str("What the job is about, in the caller's words"),
        bradskande: { type: "string", enum: ["planned", "soon", "emergency"] },
        osaker: { type: "boolean", description: "Some detail is uncertain and needs a look" },
      },
      ["tid_id", "beskrivning"],
    ),
  },
  {
    name: "hamta_bokningar",
    description: "The caller's coming visits. Only for the customer this call has identified.",
    input_schema: obj({}, []),
  },
  {
    name: "omboka_bokning",
    description:
      "Move a coming visit to a time from foresla_tider. Requires bekrafta_kund first, and the firm's limit for changes.",
    input_schema: obj(
      { besok_id: str("The visit's id from hamta_bokningar"), tid_id: str("The new time's id") },
      ["besok_id", "tid_id"],
    ),
  },
  {
    name: "avboka_bokning",
    description: "Cancel a coming visit. Requires bekrafta_kund first, and the firm's limit.",
    input_schema: obj({ besok_id: str("The visit's id from hamta_bokningar") }, ["besok_id"]),
  },
  {
    name: "skicka_lank",
    description:
      "Send the caller a link by sms: 'atkomst' to enter codes safely, 'bokning' to see or change the booking, 'typskylt' or 'bilder' to upload pictures.",
    input_schema: obj(
      { typ: { type: "string", enum: ["typskylt", "bilder", "atkomst", "bokning"] } },
      ["typ"],
    ),
  },
  {
    name: "satt_vantelista",
    description: "Put the caller on the waitlist when no time suits.",
    input_schema: obj(
      {
        tjanst_id: str("Service id"),
        omrade_id: str("Area id, if known"),
        fran: str("Earliest date YYYY-MM-DD"),
        till: str("Latest date YYYY-MM-DD"),
        namn: str("Caller's name, for a new customer"),
      },
      ["tjanst_id"],
    ),
  },
  {
    name: "koppla_till_mekaniker",
    description:
      "Try to connect the call to the mechanic (spec 8.4). Returns 'kopplad' or 'ej_svar'; on 'ej_svar' take a message.",
    input_schema: obj(
      {
        skal: str("Why, in a sentence"),
        prioritet: { type: "string", enum: ["normal", "hog"] },
      },
      ["skal", "prioritet"],
    ),
  },
  {
    name: "skapa_meddelande",
    description: "Leave a message for the firm, which becomes a task with the call attached.",
    input_schema: obj(
      {
        skal: { type: "string", enum: ["ring_upp", "akut", "reklamation", "foretag", "annat"] },
        prioritet: { type: "string", enum: ["normal", "hog"] },
        text: str("The message, in a few sentences"),
        namn: str("Caller's name, if unknown to the firm"),
      },
      ["skal", "prioritet", "text"],
    ),
  },
  {
    name: "stoppa_inspelning",
    description: "The caller does not want the call recorded.",
    input_schema: obj({}, []),
  },
  {
    name: "avsluta_samtal",
    description: "End the call with a summary and its outcome. The call's token stops working.",
    input_schema: obj(
      {
        sammanfattning: str("What the call was about and what happens next"),
        utfall: { type: "string", enum: ["booked", "message", "transferred", "spam"] },
      },
      ["sammanfattning", "utfall"],
    ),
  },
];

// --- The call's token ----------------------------------------------------------------------

export interface CallClaims {
  callId: string;
  tenantId: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/** A call lasts at most this long; the token stops working then, or when the call ends. */
export const CALL_TOKEN_MINUTES = 60;

const sign = (secret: string, body: string) =>
  createHmac("sha256", secret).update(`voice-tools:${body}`).digest("base64url");

/** A token for one call and firm: `{callId}.{tenantId}.{expires}.{signature}`. */
export function sealCallToken(secret: string, claims: CallClaims): string {
  const body = `${claims.callId}.${claims.tenantId}.${String(claims.expiresAt)}`;
  return `${body}.${sign(secret, body)}`;
}

/** The claims, or null when the token is changed, signed with another key or has expired. */
export function openCallToken(secret: string, token: string, now: Date): CallClaims | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [callId, tenantId, expires, signature] = parts as [string, string, string, string];
  const body = `${callId}.${tenantId}.${expires}`;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;
  return { callId, tenantId, expiresAt };
}

// --- The control question ------------------------------------------------------------------

/** What the caller may name to show it is their boat (spec 8.3 point 4). */
export interface ControlFacts {
  boats: { name: string | null; make: string | null; model: string | null }[];
  places: string[];
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words worth matching: three letters or more, and not the usual small words. */
const STOP = new Set([
  "och",
  "den",
  "det",
  "som",
  "min",
  "mitt",
  "har",
  "ligger",
  "pa",
  "vid",
  "marina",
  "bat",
  "baten",
  "en",
  "ett",
]);
const words = (text: string) =>
  fold(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * Whether the caller's words name one of the customer's boats (its name, or its model) or one
 * of its places. The make alone is not enough: "Volvo" fits half the harbour.
 */
export function answersControl(answer: string, facts: ControlFacts): boolean {
  const said = ` ${fold(answer)} `;
  if (said.trim().length < 3) return false;
  const has = (phrase: string | null) => {
    if (!phrase) return false;
    const w = words(phrase);
    return w.length > 0 && w.every((x) => said.includes(` ${x} `));
  };
  return facts.boats.some((b) => has(b.name) || has(b.model)) || facts.places.some((p) => has(p));
}

/** Tries before the control question is closed for the call. */
export const CONTROL_ATTEMPTS = 3;

// --- Offered times -------------------------------------------------------------------------

/** A time foresla_tider offered, as everything skapa_bokning needs to book it. */
export interface OfferedTime {
  callId: string;
  serviceTypeId: string;
  mechanicId: string;
  start: string;
  mode: "water" | "land" | "indoor";
  place: { locationId: string } | { address: string; lng: number; lat: number };
}

/**
 * The offered time as the id the model passes back, signed: only times this call was offered
 * can be booked or moved to (spec 8.2: no times outside foresla_tider).
 */
export function sealOffer(secret: string, offer: OfferedTime): string {
  const body = Buffer.from(JSON.stringify(offer)).toString("base64url");
  return `${body}.${sign(secret, `offer:${body}`)}`;
}

/** The offer, or null when it is changed, signed elsewhere or offered in another call. */
export function openOffer(secret: string, id: string, callId: string): OfferedTime | null {
  const [body, signature, extra] = id.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, `offer:${body}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const offer = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OfferedTime;
    return offer.callId === callId ? offer : null;
  } catch {
    return null;
  }
}
