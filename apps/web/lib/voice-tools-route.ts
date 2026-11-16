/**
 * The receptionist's tool API (byggplan step 6.1, spec 8.2), for the voice agent (step 6.2).
 *
 *   POST /api/voice-tools/samtal   Authorization: Bearer {VOICE_SERVICE_SECRET}
 *        { to, from, externalId }  → 201 { callId, token, expiresAt, firma, kontext, verktyg }
 *   POST /api/voice-tools/transkript   Authorization: Bearer {VOICE_SERVICE_SECRET}
 *        { callId, transkript }    → 204, after the call (step 6.3)
 *   POST /api/voice-tools/{tool}   Authorization: Bearer {the call's token}
 *        { ...the tool's input }   → 200 { ...the tool's answer }
 *   POST /api/voice-tools/kopplingsutfall   Authorization: Bearer {the call's token}
 *        { besvarad, mal_id }      → 200, how the transfer went (step 6.4; the agent's own,
 *                                    not a tool for the model)
 *
 * A call's token is short-lived, for one call and one firm, and stops working when the call
 * ends. The answers are the tools' own, built from allow-lists: no codes, no addresses.
 * Nothing the caller or the model sends is written to the log.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  VOICE_TOOLS,
  isVoiceTool,
  openCallToken,
  sealCallToken,
  type VoiceToolName,
} from "@bojen/core";
import type { AgentContext, CallRow, ReceptionistFacts } from "@bojen/db";

export interface VoiceToolsDeps {
  /** `VOICE_SERVICE_SECRET`: only the voice agent may start calls. */
  serviceSecret: () => string | null;
  /** `VOICE_TOOLS_SECRET`: signs the calls' tokens. */
  tokenSecret: () => string;
  now: () => Date;
  start: (input: {
    to: string;
    from: string | null;
    externalId: string | null;
  }) => Promise<{ callId: string; tenantId: string; expiresAt: number } | null>;
  openCall: (tenantId: string, callId: string) => Promise<CallRow | null>;
  context: (call: CallRow) => Promise<AgentContext>;
  /** The firm, for the system prompt: services, places, prices and its settings. */
  facts: (tenantId: string) => Promise<ReceptionistFacts | null>;
  run: (tool: VoiceToolName | typeof TRANSFER_RESULT, call: CallRow, input: unknown) => Promise<unknown>;
  /** The ended call's transcript, kept scrubbed and summarised in the worker. */
  saveTranscript: (callId: string, transcript: string) => Promise<boolean>;
}

/** The voice agent reports how a transfer went (step 6.4); the model never calls it. */
export const TRANSFER_RESULT = "kopplingsutfall";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

const bearer = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
};

/** Compares secrets without telling by the time how much of them was right. */
function same(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const value = (await request.json().catch(() => null)) as unknown;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createVoiceToolsRoute(deps: VoiceToolsDeps) {
  return {
    /** A new call: the call's token, the customer context and the tools for the model. */
    async startCall(request: Request): Promise<Response> {
      const secret = deps.serviceSecret();
      if (!secret || !same(bearer(request), secret)) return json({ error: "unauthorized" }, 401);
      const input = await body(request);
      const to = typeof input?.to === "string" ? input.to : null;
      if (!to) return json({ error: "invalid_input" }, 400);
      const from = typeof input?.from === "string" && input.from.trim() ? input.from : null;
      const externalId =
        typeof input?.externalId === "string" ? input.externalId.slice(0, 200) : null;
      const started = await deps.start({ to, from, externalId });
      if (!started) return json({ error: "unknown_number" }, 404);
      const call = await deps.openCall(started.tenantId, started.callId);
      if (!call) return json({ error: "unknown_number" }, 404);
      return json(
        {
          callId: started.callId,
          token: sealCallToken(deps.tokenSecret(), started),
          expiresAt: new Date(started.expiresAt).toISOString(),
          firma: await deps.facts(started.tenantId),
          kontext: await deps.context(call),
          verktyg: VOICE_TOOLS,
        },
        201,
      );
    },

    /** The call's transcript once it has ended, from the voice agent. */
    async transcript(request: Request): Promise<Response> {
      const secret = deps.serviceSecret();
      if (!secret || !same(bearer(request), secret)) return json({ error: "unauthorized" }, 401);
      const input = await body(request);
      const callId = typeof input?.callId === "string" ? input.callId : "";
      const text = typeof input?.transkript === "string" ? input.transkript : "";
      if (!/^[0-9a-f-]{36}$/i.test(callId) || !text.trim()) {
        return json({ error: "invalid_input" }, 400);
      }
      return (await deps.saveTranscript(callId, text))
        ? new Response(null, { status: 204, headers: NO_STORE })
        : json({ error: "not_found" }, 404);
    },

    /** One tool, for the call the token names. */
    async tool(request: Request, name: string): Promise<Response> {
      const claims = openCallToken(deps.tokenSecret(), bearer(request), deps.now());
      if (!claims) return json({ error: "unauthorized" }, 401);
      if (!isVoiceTool(name) && name !== TRANSFER_RESULT) return json({ error: "unknown_tool" }, 404);
      const call = await deps.openCall(claims.tenantId, claims.callId);
      // An ended call's token is worth nothing, even before it expires.
      if (!call) return json({ error: "unauthorized" }, 401);
      const input = (await body(request)) ?? {};
      try {
        return json(await deps.run(name, call, input));
      } catch (error) {
        // The tool's name only: what the caller said stays out of the log.
        console.error(`[voice-tools] ${name} failed`, (error as Error).name);
        return json({ error: "failed" }, 500);
      }
    },
  };
}
