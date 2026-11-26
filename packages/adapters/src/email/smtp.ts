import type { EmailSender } from "@bojen/core";
import { createTransport } from "nodemailer";

/** The part of a nodemailer transport the adapter uses, so tests can pass a fake. */
export interface MailTransport {
  sendMail(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
  }): Promise<{ messageId?: string }>;
}

export interface SmtpOptions {
  transport: MailTransport;
  /** Default sender, for example `Bojen <noreply@bojen.app>`. */
  from: string;
}

/**
 * E-mail through Bojen's own mail server (Stalwart on the server, docs/egen-drift.md), which
 * signs it with DKIM and delivers it. The app logs in like any mail client.
 */
export function createSmtpEmail(options: SmtpOptions): EmailSender {
  return {
    async send(message) {
      const result = await options.transport.sendMail({
        from: message.from ?? options.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });
      if (!result.messageId) throw new Error("The mail server returned no message id");
      return { id: result.messageId };
    },
  };
}

/**
 * The mail server when `SMTP_HOST` is set (production), otherwise null so the caller can use
 * the fake. Submission with implicit TLS on 465; the certificate must match `SMTP_HOST`.
 */
export function smtpEmailFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  const host = env.SMTP_HOST;
  if (!host) return null;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  if (!user || !pass) throw new Error("SMTP_USER and SMTP_PASSWORD must be set with SMTP_HOST");
  const port = Number(env.SMTP_PORT ?? "465");
  const transport = createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 10_000,
    socketTimeout: 10_000,
  });
  return createSmtpEmail({ transport, from: env.MAIL_FROM ?? `Bojen <${user}>` });
}
