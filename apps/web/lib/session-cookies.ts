/**
 * The staff session cookies (byggplan step 2.7). Kept apart from the rest of the sign-in code
 * so the middleware can use them without loading the database.
 */
import type { AuthSession } from "@bojen/core";

export const ACCESS_COOKIE = "bojen_access";
export const REFRESH_COOKIE = "bojen_refresh";
/** A signed-out staff member signs in again after two weeks without use. */
const REFRESH_DAYS = 14;

function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeSeconds)))}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** The two Set-Cookie headers for a session, or for signing out when `session` is null. */
export function sessionCookies(session: AuthSession | null, now: Date, secure: boolean): string[] {
  if (!session)
    return [cookie(ACCESS_COOKIE, "", 0, secure), cookie(REFRESH_COOKIE, "", 0, secure)];
  const accessSeconds = (session.expiresAt.getTime() - now.getTime()) / 1000 - 60;
  return [
    cookie(ACCESS_COOKIE, session.accessToken, accessSeconds, secure),
    cookie(REFRESH_COOKIE, session.refreshToken, REFRESH_DAYS * 86_400, secure),
  ];
}

/** Reads one cookie from a `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
