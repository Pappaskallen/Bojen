import { KMSClient } from "@aws-sdk/client-kms";
import type { Kms } from "@bojen/core/crypto";
import { createAwsKms } from "./aws";
import { localKmsFromEnv } from "./local";

/**
 * AWS KMS in eu-north-1 when `KMS_KEY_ID` is set (production), otherwise the local KMS from
 * `LOCAL_KMS_MASTER_KEY` (development and tests). Production refuses the local one.
 */
export function kmsFromEnv(env: NodeJS.ProcessEnv = process.env, production = false): Kms {
  const keyId = env.KMS_KEY_ID;
  if (keyId) return createAwsKms(new KMSClient({ region: env.AWS_REGION ?? "eu-north-1" }), keyId);
  if (production) throw new Error("KMS_KEY_ID is not set; production needs AWS KMS");
  return localKmsFromEnv(env);
}
