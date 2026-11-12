import { createHmac } from "node:crypto";

/**
 * What an authenticator app shows (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits). Each code is
 * handed out once: when the last one came from the same 30-second step, this waits for the
 * next step, so a test never sends the same code twice.
 */
const lastStep = new Map<string, number>();

function code(secret: string, step: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = (hmac[19] ?? 0) & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export async function totp(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if (lastStep.get(secret) === step) {
    await new Promise((resolve) => setTimeout(resolve, (step + 1) * 30_000 - Date.now() + 200));
    step = Math.floor(Date.now() / 30_000);
  }
  lastStep.set(secret, step);
  return code(secret, step);
}
