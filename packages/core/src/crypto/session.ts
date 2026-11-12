import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A small signed token for the public booking page: who the customer is after the sms code,
 * for one firm, for a limited time. HMAC-SHA256 with a server secret; nothing secret inside.
 */
export interface BookingSession {
  tenantId: string;
  customerId: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export const SESSION_TTL_SECONDS = 60 * 60;

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function signature(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signSession(
  session: Omit<BookingSession, "exp">,
  secret: string,
  now: Date,
): string {
  if (secret.length < 32) throw new Error("The session secret must be at least 32 characters");
  const payload: BookingSession = {
    ...session,
    exp: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${encode(signature(body, secret))}`;
}

/** The session, or null when the token is malformed, forged or expired. */
export function verifySession(token: string, secret: string, now: Date): BookingSession | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = signature(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as BookingSession;
    if (typeof parsed.tenantId !== "string" || typeof parsed.customerId !== "string") return null;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 <= now.getTime()) return null;
    return parsed;
  } catch {
    return null;
  }
}
