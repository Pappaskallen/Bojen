/**
 * Staff sign-in (byggplan step 2.7): a one-time code by e-mail through Supabase Auth.
 *
 *   POST /api/auth/code    { email }        → 204, the same answer for unknown addresses
 *   POST /api/auth/verify  { email, code }  → 204 and session cookies, or 401
 *   POST /api/auth/logout                   → 204 and cleared cookies
 *
 * The session lives in two httpOnly cookies. The access cookie expires a minute before the
 * token does, so the middleware refreshes it in time with the refresh cookie.
 */
import type { StaffAuth } from "@bojen/core";
import { findStaffByEmail, linkAuthUser, type Database } from "@bojen/db";
import type { RequestContext } from "./bookings";
import { ACCESS_COOKIE, readCookie, sessionCookies } from "./session-cookies";

export { ACCESS_COOKIE, REFRESH_COOKIE, readCookie, sessionCookies } from "./session-cookies";

export interface StaffAuthDeps {
  db: () => Database;
  auth: () => StaffAuth;
  now: () => Date;
  /** Cookies only over https in production. */
  secure: boolean;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** The staff member behind an access token, if it is valid and belongs to a firm. */
export async function staffFromToken(
  auth: StaffAuth,
  token: string | null,
): Promise<RequestContext | null> {
  if (!token) return null;
  const claims = await auth.claims(token);
  if (!claims?.tenantId || !claims.appUserId) return null;
  return { tenantId: claims.tenantId, actor: { type: "staff", id: claims.appUserId } };
}

/**
 * The caller of a staff API route. Requests that change something must come from this site:
 * the cookie is sent with SameSite=Lax, and the Origin check stops the rest.
 */
export async function staffFromRequest(
  auth: StaffAuth,
  request: Request,
): Promise<RequestContext | null> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Compared with the Host header: behind Next.js and proxies `request.url` may name
    // another host than the browser used.
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (origin && (!host || hostOf(origin) !== host)) return null;
  }
  return staffFromToken(auth, readCookie(request.headers.get("cookie"), ACCESS_COOKIE));
}

async function email(request: Request): Promise<{ email: string; code: unknown } | null> {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    code?: unknown;
  } | null;
  if (!body || typeof body.email !== "string" || body.email.length > 254) return null;
  return { email: body.email.trim().toLowerCase(), code: body.code };
}

export function createStaffAuthRoutes(deps: StaffAuthDeps) {
  const noContent = (headers: string[] = []) => {
    const response = new Response(null, { status: 204 });
    for (const h of headers) response.headers.append("Set-Cookie", h);
    return response;
  };

  return {
    async code(request: Request): Promise<Response> {
      const input = await email(request);
      if (!input)
        return Response.json({ error: "invalid_input", detail: "email" }, { status: 400 });
      const staff = await findStaffByEmail(deps.db(), input.email);
      // Unknown addresses get the same answer, so the form cannot be used to find out who works where.
      if (staff) {
        const auth = deps.auth();
        if (!staff.authUserId)
          await linkAuthUser(deps.db(), staff.id, await auth.ensureUser(input.email));
        await auth.sendCode(input.email);
      }
      return noContent();
    },

    async verify(request: Request): Promise<Response> {
      const input = await email(request);
      if (!input || typeof input.code !== "string" || !/^\s*\d{6}\s*$/.test(input.code)) {
        return Response.json({ error: "invalid_input" }, { status: 400 });
      }
      const session = await deps.auth().verifyCode(input.email, input.code);
      if (!session) return Response.json({ error: "invalid_code" }, { status: 401 });
      return noContent(sessionCookies(session, deps.now(), deps.secure));
    },

    async logout(request: Request): Promise<Response> {
      const token = readCookie(request.headers.get("cookie"), ACCESS_COOKIE);
      if (token) await deps.auth().signOut(token);
      return noContent(sessionCookies(null, deps.now(), deps.secure));
    },
  };
}
