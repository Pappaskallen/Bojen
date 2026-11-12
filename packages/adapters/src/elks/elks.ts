import type { SmsSender } from "@bojen/core";

export interface ElksOptions {
  /** API username and password from the 46elks dashboard. */
  username: string;
  password: string;
  /** Default sender: a number in E.164 or a name of at most 11 letters. */
  from: string;
  /** Where 46elks posts delivery reports (`whendelivered`), with its secret token. */
  deliveryUrl?: string;
  /** `https://api.46elks.com`; the end-to-end tests point it at a fake server. */
  baseUrl?: string;
  /** Sends nothing and costs nothing, but 46elks checks the request (`dryrun=yes`). */
  dryRun?: boolean;
  fetch?: typeof globalThis.fetch;
}

export class ElksError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`46elks answered ${String(status)}: ${detail.slice(0, 200)}`);
    this.name = "ElksError";
  }
}

/**
 * Sms through 46elks (Swedish, servers in Sweden). The text is sent as is: 46elks picks
 * GSM-7 or UCS-2 from the characters, as `messaging/segments.ts` counts them.
 */
export function createElksSms(options: ElksOptions): SmsSender {
  const send = options.fetch ?? globalThis.fetch;
  const base = (options.baseUrl ?? "https://api.46elks.com").replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`;
  return {
    async send(message) {
      const form = new URLSearchParams({
        from: message.from ?? options.from,
        to: message.to,
        message: message.body,
      });
      if (options.deliveryUrl) form.set("whendelivered", options.deliveryUrl);
      if (options.dryRun) form.set("dryrun", "yes");
      const response = await send(`${base}/a1/sms`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await response.text();
      if (!response.ok) throw new ElksError(response.status, text);
      const id = (JSON.parse(text) as { id?: unknown }).id;
      if (typeof id !== "string") throw new ElksError(response.status, "no id in answer");
      return { id };
    },
  };
}

/** A delivery report from 46elks (`whendelivered`), as posted to the webhook. */
export interface ElksDeliveryReport {
  id: string;
  status: "delivered" | "failed" | "sent";
  /** When the phone got it, if delivered. */
  delivered: Date | null;
}

/** Reads the form 46elks posts; null when it is not a delivery report. */
export function parseElksDeliveryReport(form: URLSearchParams): ElksDeliveryReport | null {
  const id = form.get("id");
  const status = form.get("status");
  if (!id || (status !== "delivered" && status !== "failed" && status !== "sent")) return null;
  const deliveredRaw = form.get("delivered");
  const delivered = deliveredRaw
    ? new Date(deliveredRaw.replace(" ", "T") + (/[Z+]/.test(deliveredRaw) ? "" : "Z"))
    : null;
  return {
    id,
    status,
    delivered: delivered && !Number.isNaN(delivered.getTime()) ? delivered : null,
  };
}
