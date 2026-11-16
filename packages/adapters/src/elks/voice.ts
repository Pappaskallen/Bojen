/**
 * Incoming calls through 46elks (byggplan step 6.4, rule K10). The firm's number has
 * `voice_start` pointing at the web app, which answers with call actions: first the voice
 * agent over SIP, and when that fails or is busy, the mechanic's mobile, then the voicemail.
 * 46elks moves on by itself, so a call still reaches a person when the agent stops halfway.
 */
import type { IncomingStep } from "@bojen/core";

export type ElksAction = Record<string, unknown>;

export interface IncomingTargets {
  /** The agent's SIP address, for example `sip:bojen@sip.livekit.example`. */
  agentSip: string | null;
  /** The mechanic's mobile in E.164. */
  mechanic: string | null;
  /** Where 46elks posts the recording, with the webhook's token. */
  voicemailUrl: string;
  /** Seconds each phone rings before the next step. */
  agentSeconds?: number;
  mechanicSeconds?: number;
}

/** The steps as one nested 46elks answer; each step's `failed` and `busy` is the next. */
export function elksCallActions(steps: readonly IncomingStep[], t: IncomingTargets): ElksAction {
  const build = (i: number): ElksAction => {
    const step = steps[i];
    const rest = i + 1 < steps.length ? build(i + 1) : { hangup: "reject" };
    if (step === "agent" && t.agentSip) {
      return { connect: t.agentSip, timeout: String(t.agentSeconds ?? 10), failed: rest, busy: rest };
    }
    if (step === "mechanic" && t.mechanic) {
      // No callerid: the mechanic sees the caller's own number and can call back.
      return { connect: t.mechanic, timeout: String(t.mechanicSeconds ?? 25), failed: rest, busy: rest };
    }
    if (step === "voicemail") {
      return { play: "sound/beep", next: { record: t.voicemailUrl, timelimit: "120" } };
    }
    return rest;
  };
  return steps.length > 0 ? build(0) : { hangup: "reject" };
}

/** The form 46elks posts to `voice_start`. */
export interface ElksIncomingCall {
  callId: string;
  from: string | null;
  to: string;
}

export function parseElksIncomingCall(form: URLSearchParams): ElksIncomingCall | null {
  const to = form.get("to");
  const callId = form.get("callid");
  if (!to || !callId) return null;
  const from = form.get("from");
  return { callId, from: from && /^\+\d{7,15}$/.test(from) ? from : null, to };
}

/** The form 46elks posts to the `record` address when the voicemail is done. */
export interface ElksRecording {
  callId: string;
  from: string | null;
  to: string;
  wav: string;
  seconds: number;
}

export function parseElksRecording(form: URLSearchParams): ElksRecording | null {
  const wav = form.get("wav");
  const to = form.get("to");
  const callId = form.get("callid");
  if (!wav || !to || !callId) return null;
  // Only 46elks' own recordings are fetched, with the account's password.
  let url: URL;
  try {
    url = new URL(wav);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/(^|\.)46elks\.com$/.test(url.hostname)) return null;
  const from = form.get("from");
  return {
    callId,
    from: from && /^\+\d{7,15}$/.test(from) ? from : null,
    to,
    wav,
    seconds: Number(form.get("duration")) || 0,
  };
}

/** Fetches a recording from 46elks (kept there for 72 hours). */
export function createElksRecordings(options: {
  username: string;
  password: string;
  fetch?: typeof globalThis.fetch;
}) {
  const send = options.fetch ?? globalThis.fetch;
  const auth = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`;
  return {
    async fetch(wav: string): Promise<{ bytes: Uint8Array; contentType: string }> {
      const response = await send(wav, {
        headers: { authorization: auth },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`46elks recording: ${String(response.status)}`);
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: "audio/wav" };
    },
  };
}

export type ElksRecordings = ReturnType<typeof createElksRecordings>;
