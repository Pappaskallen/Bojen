import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for single fields (spec 10.4).
 *
 * Layout of a stored value: `version (1) | iv (12) | auth tag (16) | ciphertext`.
 * The additional authenticated data (AAD) names the tenant and the field, so a value
 * copied to another firm or another column fails to decrypt.
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
export const DATA_KEY_BYTES = 32;

/** The fields that hold access information, used in the AAD. */
export type EncryptedField =
  | "access_info.code"
  | "access_info.key_location"
  | "location_access_rule.gate_code"
  | "location_access_rule.key_box";

export function fieldAad(tenantId: string, field: EncryptedField): Buffer {
  return Buffer.from(`bojen:v1:${tenantId}:${field}`, "utf8");
}

export class DecryptionError extends Error {
  constructor(message = "The value could not be decrypted") {
    super(message);
    this.name = "DecryptionError";
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== DATA_KEY_BYTES) {
    throw new Error(`Data key must be ${String(DATA_KEY_BYTES)} bytes`);
  }
}

export function encryptField(key: Buffer, plaintext: string, aad: Buffer): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptField(key: Buffer, stored: Buffer, aad: Buffer): string {
  assertKey(key);
  if (stored.length < HEADER_BYTES || stored[0] !== VERSION) {
    throw new DecryptionError("Unknown format of encrypted value");
  }
  const iv = stored.subarray(1, 1 + IV_BYTES);
  const tag = stored.subarray(1 + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(stored.subarray(HEADER_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Never include the key, the ciphertext or a partial plaintext in the error.
    throw new DecryptionError();
  }
}
