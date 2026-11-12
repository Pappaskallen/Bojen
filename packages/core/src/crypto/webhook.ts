import { createHmac, timingSafeEqual } from "node:crypto";

/** How old a signed webhook may be before it is refused as a replay. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Checks a Standard Webhooks signature, the scheme Supabase Auth hooks use: HMAC-SHA256 of
 * `{id}.{timestamp}.{body}` with the secret (`v1,whsec_<base64>`), sent as
 * `webhook-signature: v1,<base64> …`. Any one matching signature is enough.
 */
export function standardWebhookValid(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now: Date;
}): boolean {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(input.now.getTime() / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS)
    return false;
  const key = Buffer.from(input.secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${input.body}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Compares a secret token (for example in a webhook URL) in constant time. */
export function tokenMatches(given: string | null, expected: string): boolean {
  if (!given || expected.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
