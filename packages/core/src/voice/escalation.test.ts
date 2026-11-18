import { describe, expect, it } from "vitest";
import {
  alertChannels,
  callNudge,
  followUp,
  incomingRoute,
  isOnCall,
  onCallOrder,
  planMessage,
  planTransfer,
  whisperLine,
} from "./escalation";
import { describeOnCall, receptionistSettings, type OnCallSettings } from "./settings";

// Summer time in 2027 starts on 28 March, so Stockholm is UTC+2 in these tests.
const at = (local: string) => new Date(`${local}:00+02:00`);
const MONDAY_EVENING = at("2027-04-05T17:30");

const evenings: OnCallSettings = {
  windows: [
    { days: [1, 2, 3, 4, 5], from: "07:00", to: "17:00" },
    { days: [1, 2, 3, 4, 5], from: "17:00", to: "22:00" },
    { days: [6, 7], from: "09:00", to: "16:00" },
  ],
  mechanicIds: [],
  weekendEmergency: true,
};

describe("on call", () => {
  it("follows the windows by the Stockholm clock", () => {
    expect(isOnCall(evenings, MONDAY_EVENING)).toBe(true);
    expect(isOnCall(evenings, at("2027-04-05T06:59"))).toBe(false);
    expect(isOnCall(evenings, at("2027-04-05T22:00"))).toBe(false);
    expect(isOnCall(evenings, at("2027-04-10T10:00"))).toBe(true);
    // In winter the same clock time is another UTC hour.
    expect(isOnCall(evenings, new Date("2027-01-11T16:30:00Z"))).toBe(true);
    expect(isOnCall(evenings, new Date("2027-01-11T21:30:00Z"))).toBe(false);
  });

  it("lets a window run past midnight into the next day", () => {
    const nights: OnCallSettings = {
      windows: [{ days: [5], from: "22:00", to: "02:00" }],
      mechanicIds: [],
      weekendEmergency: true,
    };
    expect(isOnCall(nights, at("2027-04-09T23:00"))).toBe(true);
    expect(isOnCall(nights, at("2027-04-10T01:59"))).toBe(true);
    expect(isOnCall(nights, at("2027-04-10T02:00"))).toBe(false);
    // Thursday night is not Friday's window.
    expect(isOnCall(nights, at("2027-04-09T01:00"))).toBe(false);
  });

  it("offers no weekend emergencies when the firm says no", () => {
    expect(isOnCall({ ...evenings, weekendEmergency: false }, at("2027-04-10T10:00"))).toBe(false);
    expect(isOnCall({ ...evenings, weekendEmergency: false }, MONDAY_EVENING)).toBe(true);
  });

  it("is never on call without windows", () => {
    expect(isOnCall(receptionistSettings({}).onCall, MONDAY_EVENING)).toBe(false);
  });

  it("tries the firm's on-call list, else all staff", () => {
    const staff = ["owner", "anna", "bo"];
    expect(onCallOrder({ ...evenings, mechanicIds: ["bo", "gone", "anna"] }, staff)).toEqual([
      "bo",
      "anna",
    ]);
    expect(onCallOrder(evenings, staff)).toEqual(staff);
  });
});

describe("the settings", () => {
  it("read the windows and describe them for the prompt", () => {
    const s = receptionistSettings({
      receptionist: {
        onCall: {
          windows: [
            { days: [5, 1, 2, 3, 4], from: "17:00", to: "22:00" },
            { days: [6, 7], from: "09:30", to: "16:00" },
            { days: [9], from: "07:00", to: "08:00" },
            { days: [1], from: "25:00", to: "08:00" },
          ],
          mechanicIds: ["not-an-id", "6f1c2a3b-0000-4000-8000-000000000001"],
          weekendEmergency: true,
        },
        transferSeconds: 5,
      },
    });
    expect(s.onCall.windows).toHaveLength(2);
    expect(s.onCall.mechanicIds).toEqual(["6f1c2a3b-0000-4000-8000-000000000001"]);
    expect(s.onCallHours).toBe("mån–fre 17–22, lör, sön 09:30–16");
    expect(s.transferSeconds).toBe(20);
    expect(s.escalateAfterMinutes).toBe(30);
    expect(describeOnCall([])).toBe("ingen jour");
  });
});

describe("putting the call through", () => {
  const base = { candidates: ["anna", "bo", "cia"], timeoutSeconds: 20 } as const;

  it("K2, K4 and K5: on call, to at most two mechanics with the whisper's time limit", () => {
    for (const reason of ["akut", "manniska", "reklamation"] as const) {
      expect(planTransfer({ ...base, reason, onCall: true })).toEqual({
        do: "transfer",
        targets: ["anna", "bo"],
        timeoutSeconds: 20,
      });
    }
  });

  it("K3 and K4 outside on-call: a message instead", () => {
    expect(planTransfer({ ...base, reason: "akut", onCall: false })).toEqual({
      do: "message",
      why: "not_on_call",
    });
    expect(planTransfer({ ...base, candidates: [], reason: "manniska", onCall: true })).toEqual({
      do: "message",
      why: "no_staff",
    });
  });

  it("whispers who is calling and why before the caller is let in", () => {
    expect(
      whisperLine({
        firm: "Skärgårdsmek",
        caller: "Per",
        boat: "Nimbusen",
        reason: "akut",
        summary: "Motorn stannade vid Sandhamn och startar inte",
      }),
    ).toBe(
      "Skärgårdsmek här. Jag har ett akut samtal från Per om Nimbusen: Motorn stannade vid Sandhamn och startar inte. Säg ja eller tryck 1 för att ta det.",
    );
    expect(
      whisperLine({
        firm: "F",
        caller: null,
        boat: null,
        reason: "manniska",
        summary: "Vill prata!",
      }),
    ).toBe("F här. Jag har ett samtal: Vill prata. Säg ja eller tryck 1 för att ta det.");
  });
});

describe("messages", () => {
  const plan = (reason: Parameters<typeof planMessage>[0]["reason"], onCall = true) =>
    planMessage({ reason, onCall, now: MONDAY_EVENING, escalateAfterMinutes: 30 });

  it("K1: danger is critical for the mechanic, and the caller already has 112", () => {
    expect(plan("fara")).toMatchObject({
      priority: "high",
      taskType: "emergency",
      alert: "critical",
      callerSms: null,
      escalates: false,
    });
  });

  it("K2 without an answer: critical, an answer within 30 minutes, and it escalates", () => {
    const p = plan("akut");
    expect(p).toMatchObject({ alert: "critical", callerSms: "within_30", escalates: true });
    expect(p.dueAt).toEqual(new Date(MONDAY_EVENING.getTime() + 30 * 60_000));
    expect(alertChannels(p.alert)).toEqual(["push", "sms"]);
  });

  it("K3: urgent outside on-call is a high message with the firm's promise, without waking anyone", () => {
    const p = plan("akut", false);
    expect(p).toMatchObject({
      priority: "high",
      label: "Akut",
      alert: "normal",
      callerSms: "promise",
      escalates: false,
    });
    expect(alertChannels(p.alert)).toEqual(["push"]);
  });

  it("K5, K6 and K8 are labelled; K6 is answered the same day", () => {
    expect(plan("reklamation")).toMatchObject({ priority: "high", label: "Reklamation" });
    expect(plan("sprak")).toMatchObject({ priority: "normal", label: "Annat språk" });
    const morning = at("2027-04-05T09:00");
    expect(
      planMessage({ reason: "foretag", onCall: true, now: morning, escalateAfterMinutes: 30 })
        .dueAt,
    ).toEqual(at("2027-04-05T17:00"));
    // Late in the day: two hours on rather than a time already gone.
    expect(plan("foretag").dueAt).toEqual(at("2027-04-05T19:30"));
    expect(plan("ring_upp")).toMatchObject({ priority: "normal", label: null, escalates: false });
  });
});

describe("no one took the message", () => {
  const order = ["anna", "bo"];

  it("goes to the next mechanic on call, then the caller gets the first ordinary time", () => {
    expect(followUp({ handled: false, alerted: ["anna"], order, onCall: true })).toEqual({
      do: "alert_next",
      userId: "bo",
    });
    expect(followUp({ handled: false, alerted: ["anna", "bo"], order, onCall: true })).toEqual({
      do: "offer_first_time",
    });
    // On-call ended meanwhile: no one else is woken.
    expect(followUp({ handled: false, alerted: ["anna"], order, onCall: false })).toEqual({
      do: "offer_first_time",
    });
  });

  it("stops when a mechanic took it", () => {
    expect(followUp({ handled: true, alerted: ["anna"], order, onCall: true })).toEqual({
      do: "nothing",
    });
  });
});

describe("K7", () => {
  it("nudges the agent once after two failures or eight minutes", () => {
    expect(callNudge({ minutes: 3, failedInRow: 1, alreadyNudged: false })).toBeNull();
    expect(callNudge({ minutes: 3, failedInRow: 2, alreadyNudged: false })).toMatch(/två gånger/);
    expect(callNudge({ minutes: 8, failedInRow: 0, alreadyNudged: false })).toMatch(/8 minuter/);
    expect(callNudge({ minutes: 9, failedInRow: 2, alreadyNudged: true })).toBeNull();
  });
});

describe("K10", () => {
  it("sends the call to the agent, then the mechanic, then the voicemail", () => {
    expect(incomingRoute({ agentUp: true, mechanic: "+46701234567" })).toEqual([
      "agent",
      "mechanic",
      "voicemail",
    ]);
    expect(incomingRoute({ agentUp: false, mechanic: "+46701234567" })).toEqual([
      "mechanic",
      "voicemail",
    ]);
    expect(incomingRoute({ agentUp: false, mechanic: null })).toEqual(["voicemail"]);
  });
});
