import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Kms } from "@bojen/core/crypto";

/**
 * KMS for development and tests. Data keys are wrapped with AES-256-GCM under a local
 * master key, with the tenant id as additional authenticated data, just like the
 * encryption context in AWS KMS.
 */
export function createLocalKms(masterKey: Buffer): Kms {
  if (masterKey.length !== 32) throw new Error("The local KMS master key must be 32 bytes");

  const wrap = (tenantId: string, dataKey: Buffer) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    cipher.setAAD(Buffer.from(tenantId));
    const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };

  return {
    generateDataKey: (tenantId) => {
      const plaintext = randomBytes(32);
      return Promise.resolve({ plaintext, encrypted: wrap(tenantId, plaintext) });
    },
    decryptDataKey: (tenantId, encrypted) => {
      try {
        const decipher = createDecipheriv("aes-256-gcm", masterKey, encrypted.subarray(0, 12));
        decipher.setAAD(Buffer.from(tenantId));
        decipher.setAuthTag(encrypted.subarray(12, 28));
        return Promise.resolve(
          Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]),
        );
      } catch {
        return Promise.reject(new Error("The data key could not be unwrapped for this tenant"));
      }
    },
  };
}

/** Reads `LOCAL_KMS_MASTER_KEY` (32 bytes, base64). Create one with `openssl rand -base64 32`. */
export function localKmsFromEnv(env: NodeJS.ProcessEnv = process.env): Kms {
  const encoded = env.LOCAL_KMS_MASTER_KEY;
  if (!encoded) {
    throw new Error(
      "LOCAL_KMS_MASTER_KEY is missing. Add 32 random bytes as base64 to .env.local.",
    );
  }
  return createLocalKms(Buffer.from(encoded, "base64"));
}
