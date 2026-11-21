import { SendEmailCommand, type SESv2Client } from "@aws-sdk/client-sesv2";
import type { EmailSender } from "@bojen/core";

/** The part of the AWS client the adapter uses, so tests can pass a fake. */
export type SesSender = Pick<SESv2Client, "send">;

export interface SesOptions {
  client: SesSender;
  /** Default sender on a verified domain, for example `Bojen <noreply@bojen.se>`. */
  from: string;
}

/**
 * E-mail through Amazon SES in eu-north-1 (Stockholm), so mail and its logs stay in the EU
 * (spec 10). The AWS account is the same as for KMS.
 */
export function createSesEmail(options: SesOptions): EmailSender {
  return {
    async send(message) {
      const result = await options.client.send(
        new SendEmailCommand({
          FromEmailAddress: message.from ?? options.from,
          Destination: { ToAddresses: [message.to] },
          ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                Html: { Data: message.html, Charset: "UTF-8" },
              },
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(10_000) },
      );
      if (!result.MessageId) throw new Error("Amazon SES returned no message id");
      return { id: result.MessageId };
    },
  };
}
