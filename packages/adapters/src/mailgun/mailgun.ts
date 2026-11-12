import type { EmailSender } from "@bojen/core";

export interface MailgunOptions {
  apiKey: string;
  /** The sending domain, for example `mg.bojen.se`. */
  domain: string;
  /** Default sender, for example `Bojen <noreply@mg.bojen.se>`. */
  from: string;
  /** The EU region, so mail and logs stay in the EU (spec 10). */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export class MailgunError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Mailgun answered ${String(status)}: ${detail.slice(0, 200)}`);
    this.name = "MailgunError";
  }
}

/** E-mail through Mailgun's EU region. */
export function createMailgunEmail(options: MailgunOptions): EmailSender {
  const send = options.fetch ?? globalThis.fetch;
  const base = (options.baseUrl ?? "https://api.eu.mailgun.net").replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`api:${options.apiKey}`).toString("base64")}`;
  return {
    async send(message) {
      const form = new URLSearchParams({
        from: message.from ?? options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (message.replyTo) form.set("h:Reply-To", message.replyTo);
      const response = await send(`${base}/v3/${encodeURIComponent(options.domain)}/messages`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await response.text();
      if (!response.ok) throw new MailgunError(response.status, text);
      const id = (JSON.parse(text) as { id?: unknown }).id;
      if (typeof id !== "string") throw new MailgunError(response.status, "no id in answer");
      return { id };
    },
  };
}
