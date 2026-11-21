import { SESv2Client } from "@aws-sdk/client-sesv2";
import type { EmailSender } from "@bojen/core";
import { createSesEmail } from "./ses";

/**
 * Amazon SES when `SES_FROM` is set (production; the AWS keys come from the usual AWS
 * variables, as for KMS), otherwise null so the caller can use the fake.
 */
export function sesEmailFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  const from = env.SES_FROM;
  if (!from) return null;
  return createSesEmail({
    client: new SESv2Client({ region: env.SES_REGION ?? env.AWS_REGION ?? "eu-north-1" }),
    from,
  });
}
