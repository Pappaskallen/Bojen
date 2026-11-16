/**
 * When the receptionist puts a call through, takes a message or sends the caller elsewhere
 * (spec 8.4, rules K1–K10; byggplan step 6.4). Pure: the time, the firm's settings and the
 * staff come in, and what to do comes out. The model sorts the call into a reason; these
 * rules, not the model, decide whom it reaches and how loudly.
 */
import { isoWeekday, stockholmDate, stockholmOffsetMinutes } from "../time";
import type { OnCallSettings, OnCallWindow } from "./settings";

// --- On call --------------------------------------------------------------------------

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The Stockholm weekday and minute of the day at an instant. */
function stockholmClock(now: Date): { weekday: number; minute: number } {
  const local = new Date(now.getTime() + stockholmOffsetMinutes(now) * 60_000);
  return {
    weekday: isoWeekday(stockholmDate(now)),
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** Whether the window covers the instant; a window past midnight belongs to its first day. */
function covers(w: OnCallWindow, weekday: number, minute: number): boolean {
  const from = minutesOf(w.from);
  const to = minutesOf(w.to);
  if (from < to) return w.days.includes(weekday) && minute >= from && minute < to;
  const yesterday = weekday === 1 ? 7 : weekday - 1;
  return (
    (w.days.includes(weekday) && minute >= from) || (w.days.includes(yesterday) && minute < to)
  );
}

/**
 * Whether a call can be put through to a person now (spec 8.4 "Jourtid?"). Saturdays and
 * Sundays only count when the firm offers weekend emergencies at all.
 */
export function isOnCall(settings: OnCallSettings, now: Date): boolean {
  const { weekday, minute } = stockholmClock(now);
  // The weekend runs from Saturday 00:00 to Monday 00:00 by the clock, whichever window.
  if (!settings.weekendEmergency && weekday >= 6) return false;
  return settings.windows.some((w) => covers(w, weekday, minute));
}

/**
 * The mechanics to try, in order: the firm's on-call list where those people still work
 * there, else everyone in `staff` (owner first, as the caller sorts it).
 */
export function onCallOrder(settings: OnCallSettings, staff: readonly string[]): string[] {
  const listed = settings.mechanicIds.filter((id) => staff.includes(id));
  return listed.length > 0 ? listed : [...staff];
}

// --- Putting the call through (K2, K4, K5) -----------------------------------------------

/** Why the model wants the call put through. */
export const TRANSFER_REASONS = ["akut", "manniska", "reklamation"] as const;
export type TransferReason = (typeof TRANSFER_REASONS)[number];

export type TransferPlan =
  | {
      do: "transfer";
      /** `app_user.id`s, tried one at a time with the whisper. */
      targets: string[];
      timeoutSeconds: number;
    }
  /** No one to put it through to: the agent takes a message (K3, K4 and K5 outside on-call). */
  | { do: "message"; why: "not_on_call" | "no_staff" };

export function planTransfer(input: {
  reason: TransferReason;
  onCall: boolean;
  /** From `onCallOrder`, with a phone number each. */
  candidates: readonly string[];
  timeoutSeconds: number;
}): TransferPlan {
  if (!input.onCall) return { do: "message", why: "not_on_call" };
  if (input.candidates.length === 0) return { do: "message", why: "no_staff" };
  // At most two people while the caller waits: 2 × 20 s is already long on the phone.
  return {
    do: "transfer",
    targets: input.candidates.slice(0, 2),
    timeoutSeconds: input.timeoutSeconds,
  };
}

/** What the agent says to the mechanic before the caller is let in (K2 "medhörning"). */
export function whisperLine(input: {
  firm: string;
  caller: string | null;
  boat: string | null;
  reason: TransferReason;
  summary: string;
}): string {
  const what =
    input.reason === "akut"
      ? "ett akut samtal"
      : input.reason === "reklamation"
        ? "en reklamation"
        : "ett samtal";
  const who = [input.caller ? `från ${input.caller}` : null, input.boat ? `om ${input.boat}` : null]
    .filter(Boolean)
    .join(" ");
  return `${input.firm} här. Jag har ${what}${who ? ` ${who}` : ""}: ${input.summary.trim().replace(/[.!?]*$/, ".")} Säg ja eller tryck 1 för att ta det.`;
}

// --- Messages (K1, K2 without answer, K3, K5–K8) -----------------------------------------

export const MESSAGE_REASONS = [
  "fara",
  "akut",
  "ring_upp",
  "reklamation",
  "foretag",
  "sprak",
  "annat",
] as const;
export type MessageReason = (typeof MESSAGE_REASONS)[number];

export interface MessagePlan {
  priority: "normal" | "high";
  taskType: "emergency" | "call_back";
  /** Before the title, for example "Akut: Per ringde". */
  label: string | null;
  /** When the firm should have answered. */
  dueAt: Date;
  /** Critical wakes the on-call mechanic with an sms as well as the push (see `alertChannels`). */
  alert: "critical" | "normal";
  /** The sms to the caller after the call: "within 30 minutes", the firm's promise, or none. */
  callerSms: "within_30" | "promise" | null;
  /** The message goes to the next on-call mechanic if no one takes it in time (spec 8.4). */
  escalates: boolean;
}

const MINUTE = 60_000;

/** The end of the Stockholm working day the instant falls on, or two hours on, if later. */
function sameDay(now: Date): Date {
  const { minute } = stockholmClock(now);
  const left = Math.max(17 * 60 - minute, 120);
  return new Date(now.getTime() + left * MINUTE);
}

export function planMessage(input: {
  reason: MessageReason;
  onCall: boolean;
  now: Date;
  escalateAfterMinutes: number;
}): MessagePlan {
  const { now } = input;
  const soon = new Date(now.getTime() + input.escalateAfterMinutes * MINUTE);
  const tomorrow = new Date(now.getTime() + 24 * 60 * MINUTE);
  switch (input.reason) {
    // K1: the caller has been told to ring 112. The mechanic should know, loudly.
    case "fara":
      return {
        priority: "high",
        taskType: "emergency",
        label: "Fara, hänvisad till 112",
        dueAt: soon,
        alert: "critical",
        callerSms: null,
        escalates: false,
      };
    // K2 when the mechanic did not answer, or K3 outside on-call.
    case "akut":
      return input.onCall
        ? {
            priority: "high",
            taskType: "emergency",
            label: "Akut",
            dueAt: soon,
            alert: "critical",
            callerSms: "within_30",
            escalates: true,
          }
        : {
            priority: "high",
            taskType: "emergency",
            label: "Akut",
            dueAt: tomorrow,
            alert: "normal",
            callerSms: "promise",
            escalates: false,
          };
    // K5
    case "reklamation":
      return {
        priority: "high",
        taskType: "call_back",
        label: "Reklamation",
        dueAt: tomorrow,
        alert: "normal",
        callerSms: null,
        escalates: false,
      };
    // K6: an answer the same day.
    case "foretag":
      return {
        priority: "normal",
        taskType: "call_back",
        label: "Företag",
        dueAt: sameDay(now),
        alert: "normal",
        callerSms: null,
        escalates: false,
      };
    // K8
    case "sprak":
      return {
        priority: "normal",
        taskType: "call_back",
        label: "Annat språk",
        dueAt: tomorrow,
        alert: "normal",
        callerSms: null,
        escalates: false,
      };
    // K4 outside on-call, K7 and the rest.
    case "ring_upp":
    case "annat":
      return {
        priority: "normal",
        taskType: "call_back",
        label: null,
        dueAt: tomorrow,
        alert: "normal",
        callerSms: null,
        escalates: false,
      };
  }
}

/**
 * How a mechanic is told. A web app's push cannot sound through silent mode (only native
 * apps may, with Apple's permission), so a critical alert is also an sms.
 */
export function alertChannels(alert: MessagePlan["alert"]): ("push" | "sms")[] {
  return alert === "critical" ? ["push", "sms"] : ["push"];
}

// --- No one took it (spec 8.4 "Mekaniker svarar inom 30 min?") --------------------------

export type FollowUp =
  | { do: "nothing" }
  /** Tell the next mechanic on call and wait the same time again. */
  | { do: "alert_next"; userId: string }
  /** Everyone has been told: the caller gets the first ordinary time by sms. */
  | { do: "offer_first_time" };

export function followUp(input: {
  /** A mechanic took the message, or it is done or cancelled. */
  handled: boolean;
  alerted: readonly string[];
  /** From `onCallOrder`, at the time of the follow-up. */
  order: readonly string[];
  onCall: boolean;
}): FollowUp {
  if (input.handled) return { do: "nothing" };
  const next = input.onCall ? input.order.find((id) => !input.alerted.includes(id)) : undefined;
  return next ? { do: "alert_next", userId: next } : { do: "offer_first_time" };
}

// --- The agent nudged (K7) -------------------------------------------------------------

/** After this long, the agent offers to take a message (K7). */
export const LONG_CALL_MINUTES = 8;

/**
 * A note for the model, in the caller's turn, when the call has gone on too long or the
 * agent has failed twice in a row; null otherwise. Said once per reason.
 */
export function callNudge(input: {
  minutes: number;
  failedInRow: number;
  alreadyNudged: boolean;
}): string | null {
  if (input.alreadyNudged) return null;
  if (input.failedInRow >= 2)
    return "(Systemnotis: du har inte kommit framåt två gånger i rad. Erbjud att ta ett meddelande.)";
  if (input.minutes >= LONG_CALL_MINUTES)
    return `(Systemnotis: samtalet har pågått i över ${String(LONG_CALL_MINUTES)} minuter. Erbjud att ta ett meddelande.)`;
  return null;
}

// --- When the agent is down (K10) -------------------------------------------------------

export type IncomingStep = "agent" | "mechanic" | "voicemail";

/**
 * Where an incoming call goes, in order. 46elks tries the next step when one fails, so a
 * call reaches the mechanic's mobile when the agent is down or stops answering, and the
 * voicemail when the mechanic does not answer either.
 */
export function incomingRoute(input: {
  agentUp: boolean;
  /** The mechanic's mobile in E.164, or null when there is none. */
  mechanic: string | null;
}): IncomingStep[] {
  const steps: IncomingStep[] = [];
  if (input.agentUp) steps.push("agent");
  if (input.mechanic) steps.push("mechanic");
  steps.push("voicemail");
  return steps;
}
