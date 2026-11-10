import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { Kms } from "@bojen/core/crypto";

/** The part of the AWS client the adapter uses, so tests can pass a fake. */
export type KmsSender = Pick<KMSClient, "send">;

/**
 * AWS KMS (eu-north-1). The tenant id is sent as encryption context, so a data key
 * wrapped for one firm cannot be unwrapped for another, and CloudTrail shows which firm
 * each call was for.
 */
export function createAwsKms(client: KmsSender, keyId: string): Kms {
  const context = (tenantId: string) => ({ tenant_id: tenantId });

  return {
    async generateDataKey(tenantId) {
      const result = await client.send(
        new GenerateDataKeyCommand({
          KeyId: keyId,
          KeySpec: "AES_256",
          EncryptionContext: context(tenantId),
        }),
      );
      if (!result.Plaintext || !result.CiphertextBlob) {
        throw new Error("AWS KMS returned no data key");
      }
      return {
        plaintext: Buffer.from(result.Plaintext),
        encrypted: Buffer.from(result.CiphertextBlob),
      };
    },

    async decryptDataKey(tenantId, encrypted) {
      const result = await client.send(
        new DecryptCommand({
          KeyId: keyId,
          CiphertextBlob: encrypted,
          EncryptionContext: context(tenantId),
        }),
      );
      if (!result.Plaintext) throw new Error("AWS KMS returned no plaintext");
      return Buffer.from(result.Plaintext);
    },
  };
}
