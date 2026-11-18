/**
 * The voice agent's client for the tool API in apps/web (step 6.1): it starts the call with
 * the agent's own secret and then calls each tool with the call's short-lived token.
 */
import type { ConversationTool } from "@bojen/core";
import type { FirmFacts } from "./prompt";

export interface StartedCall {
  callId: string;
  token: string;
  expiresAt: string;
  firma: FirmFacts;
  kontext: unknown;
  verktyg: ConversationTool[];
}

export interface ToolsClient {
  startCall(input: {
    to: string;
    from: string | null;
    externalId?: string;
  }): Promise<StartedCall | null>;
  run(token: string, tool: string, input: unknown): Promise<unknown>;
  /** The ended call's transcript, for the summary (step 6.3). */
  sendTranscript(callId: string, transcript: string): Promise<void>;
}

export interface ToolsClientOptions {
  /** The web app, for example `http://localhost:3000`. */
  baseUrl: string;
  /** `VOICE_SERVICE_SECRET`. */
  serviceSecret: string;
  fetch?: typeof globalThis.fetch;
}

export function createToolsClient(options: ToolsClientOptions): ToolsClient {
  const send = options.fetch ?? globalThis.fetch;
  const base = `${options.baseUrl.replace(/\/+$/, "")}/api/voice-tools`;
  const post = (path: string, auth: string, body: unknown) =>
    send(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
      body: JSON.stringify(body),
    });
  return {
    async startCall(input) {
      const response = await post("samtal", options.serviceSecret, input);
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`The tool API refused the call: ${String(response.status)}`);
      return (await response.json()) as StartedCall;
    },
    async sendTranscript(callId, transcript) {
      const response = await post("transkript", options.serviceSecret, {
        callId,
        transkript: transcript,
      });
      if (!response.ok)
        throw new Error(`The tool API refused the transcript: ${String(response.status)}`);
    },
    async run(token, tool, input) {
      const response = await post(encodeURIComponent(tool), token, input);
      // The model reads this and tells the caller; it must not learn more than that.
      if (response.status === 401) return { fel: "samtalet_har_gatt_ut" };
      if (response.status === 404) return { fel: "okant_verktyg" };
      if (!response.ok) return { fel: "tekniskt_fel" };
      return (await response.json()) as unknown;
    },
  };
}
