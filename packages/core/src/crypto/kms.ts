/**
 * Key management for envelope encryption. Each firm has its own data key; the KMS only
 * ever sees that key, never the codes themselves. Implemented in packages/adapters/kms.
 */
export interface Kms {
  /** A new 32-byte data key, both in plaintext and wrapped by the master key. */
  generateDataKey(tenantId: string): Promise<{ plaintext: Buffer; encrypted: Buffer }>;
  /** Unwraps a data key. Fails if it was wrapped for another tenant. */
  decryptDataKey(tenantId: string, encrypted: Buffer): Promise<Buffer>;
}
