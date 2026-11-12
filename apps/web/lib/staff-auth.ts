/**
 * Staff sign-in (byggplan steps 2.7 and 2.8): a one-time code by e-mail through Supabase
 * Auth, and a second factor from an authenticator app for owners, admins and anyone who
 * has added one.
 *
 *   POST /api/auth/code       { email }            → 204, the same answer for unknown addresses
 *   POST /api/auth/verify     { email, code }      → 204 and session cookies, or 401
 *   POST /api/auth/mfa-enroll                      → { factorId, qrSvg, secret }
 *   POST /api/auth/mfa-verify { factorId, code }   → { recoveryCodes } the first time, then 204
 *   POST /api/auth/mfa-challenge { code }          → 204 and an aal2 session, or 401
 *   POST /api/auth/recover    { code }             → 204; the old factor is removed
 *   POST /api/auth/logout                          → 204 and cleared cookies
 *
 * The session lives in two httpOnly cookies. The access cookie expires a minute before the
 * token does, so the middleware refreshes it in time with the refresh cookie.
 */
import { randomBytes } from "node:crypto";
import { secondFactorStep, type SecondFactorStep, type StaffAuth } from "@bojen/core";
import { hashRecoveryCode, newRecoveryCodes } from "@bojen/core/crypto";
import {
  findStaffByEmail,
  linkAuthUser,
  recordSecondFactorReset,
  replaceRecoveryCodes,
  useRecoveryCode,
  type Database,
} from "@bojen/db";
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

/** A signed-in staff member, before or after the second factor. */
export interface StaffSession {
  context: RequestContext & { actor: { type: "staff"; id: string } };
  role: "owner" | "admin" | "mechanic";
  authUserId: string;
  aal: "aal1" | "aal2";
  factorIds: string[];
  /** What is left before the staff pages open. */
  step: SecondFactorStep;
  accessToken: string;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** The signed-in staff member behind an access token, whatever the second factor says. */
export async function staffSession(
  auth: StaffAuth,
  token: string | null,
): Promise<StaffSession | null> {
  if (!token) return null;
  const claims = await auth.claims(token);
  if (!claims?.tenantId || !claims.appUserId || !claims.role) return null;
  return {
    context: { tenantId: claims.tenantId, actor: { type: "staff", id: claims.appUserId } },
    role: claims.role,
    authUserId: claims.authUserId,
    aal: claims.aal,
    factorIds: claims.factorIds,
    step: secondFactorStep({
      role: claims.role,
      hasFactor: claims.factorIds.length > 0,
      aal: claims.aal,
    }),
    accessToken: token,
  };
}

/**
 * The staff member behind an access token, if the session is complete: valid, in a firm,
 * and with the second factor when it is required.
 */
export async function staffFromToken(
  auth: StaffAuth,
  token: string | null,
): Promise<RequestContext | null> {
  const session = await staffSession(auth, token);
  return session?.step === "none" ? session.context : null;
}

/** False for requests that change something and come from another site. */
function sameSite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  // Compared with the Host header: behind Next.js and proxies `request.url` may name
  // another host than the browser used.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return !origin || (host !== null && hostOf(origin) === host);
}

/**
 * The caller of a staff API route. Requests that change something must come from this site:
 * the cookie is sent with SameSite=Lax, and the Origin check stops the rest.
 */
export async function staffFromRequest(
  auth: StaffAuth,
  request: Request,
): Promise<RequestContext | null> {
  if (!sameSite(request)) return null;
  return staffFromToken(auth, readCookie(request.headers.get("cookie"), ACCESS_COOKIE));
}

/** Like `staffFromRequest`, but also before the second factor, for the steps that add it. */
export async function sessionFromRequest(
  auth: StaffAuth,
  request: Request,
): Promise<StaffSession | null> {
  if (!sameSite(request)) return null;
  return staffSession(auth, readCookie(request.headers.get("cookie"), ACCESS_COOKIE));
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

const SIX_DIGITS = /^\s*\d{6}\s*$/;

export function createStaffAuthRoutes(deps: StaffAuthDeps) {
  const noContent = (headers: string[] = []) => {
    const response = new Response(null, { status: 204 });
    for (const h of headers) response.headers.append("Set-Cookie", h);
    return response;
  };
  const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
  const signedIn = (request: Request) => sessionFromRequest(deps.auth(), request);

  return {
    async code(request: Request): Promise<Response> {
      const body = await readBody(request);
      if (typeof body.email !== "string" || body.email.length > 254) {
        return Response.json({ error: "invalid_input", detail: "email" }, { status: 400 });
      }
      const email = body.email.trim().toLowerCase();
      const staff = await findStaffByEmail(deps.db(), email);
      // Unknown addresses get the same answer, so the form cannot be used to find out who works where.
      if (staff) {
        const auth = deps.auth();
        if (!staff.authUserId)
          await linkAuthUser(deps.db(), staff.id, await auth.ensureUser(email));
        await auth.sendCode(email);
      }
      return noContent();
    },

    async verify(request: Request): Promise<Response> {
      const body = await readBody(request);
      if (
        typeof body.email !== "string" ||
        typeof body.code !== "string" ||
        !SIX_DIGITS.test(body.code)
      ) {
        return Response.json({ error: "invalid_input" }, { status: 400 });
      }
      const session = await deps.auth().verifyCode(body.email.trim().toLowerCase(), body.code);
      if (!session) return Response.json({ error: "invalid_code" }, { status: 401 });
      return noContent(sessionCookies(session, deps.now(), deps.secure));
    },

    /** Starts adding an authenticator app. Allowed before the second factor, never after it. */
    async mfaEnroll(request: Request): Promise<Response> {
      const session = await signedIn(request);
      if (!session) return unauthorized();
      // Someone with a factor must use it first; then they may add a new one.
      if (session.factorIds.length > 0 && session.aal !== "aal2") return unauthorized();
      return Response.json(await deps.auth().enrollTotp(session.accessToken));
    },

    /** Confirms the new app with its first code. The first factor also gets recovery codes. */
    async mfaVerify(request: Request): Promise<Response> {
      const session = await signedIn(request);
      if (!session) return unauthorized();
      const body = await readBody(request);
      if (
        typeof body.factorId !== "string" ||
        typeof body.code !== "string" ||
        !SIX_DIGITS.test(body.code)
      ) {
        return Response.json({ error: "invalid_input" }, { status: 400 });
      }
      const upgraded = await deps.auth().verifyTotp(session.accessToken, body.factorId, body.code);
      if (!upgraded) return Response.json({ error: "invalid_code" }, { status: 401 });

      const cookies = sessionCookies(upgraded, deps.now(), deps.secure);
      const response = Response.json(
        session.factorIds.length === 0
          ? { recoveryCodes: await newCodes(deps, session) }
          : { recoveryCodes: null },
      );
      for (const c of cookies) response.headers.append("Set-Cookie", c);
      return response;
    },

    async mfaChallenge(request: Request): Promise<Response> {
      const session = await signedIn(request);
      const factorId = session?.factorIds[0];
      if (!session || !factorId) return unauthorized();
      const body = await readBody(request);
      if (typeof body.code !== "string" || !SIX_DIGITS.test(body.code)) {
        return Response.json({ error: "invalid_input" }, { status: 400 });
      }
      const upgraded = await deps.auth().verifyTotp(session.accessToken, factorId, body.code);
      if (!upgraded) return Response.json({ error: "invalid_code" }, { status: 401 });
      return noContent(sessionCookies(upgraded, deps.now(), deps.secure));
    },

    /**
     * A recovery code removes the lost factor. The session stays at aal1, so the staff pages
     * stay closed until a new app is added; that also gives new recovery codes.
     */
    async recover(request: Request): Promise<Response> {
      const session = await signedIn(request);
      if (!session) return unauthorized();
      const body = await readBody(request);
      if (typeof body.code !== "string" || body.code.length > 20) {
        return Response.json({ error: "invalid_input" }, { status: 400 });
      }
      const member = { tenantId: session.context.tenantId, appUserId: session.context.actor.id };
      if (!(await useRecoveryCode(deps.db(), member, body.code, deps.now()))) {
        return Response.json({ error: "invalid_code" }, { status: 401 });
      }
      await deps.auth().removeFactors(session.authUserId);
      await recordSecondFactorReset(deps.db(), member, member.appUserId, "recovery_code");
      return noContent();
    },

    async logout(request: Request): Promise<Response> {
      const token = readCookie(request.headers.get("cookie"), ACCESS_COOKIE);
      if (token) await deps.auth().signOut(token);
      return noContent(sessionCookies(null, deps.now(), deps.secure));
    },
  };
}

async function newCodes(deps: StaffAuthDeps, session: StaffSession): Promise<string[]> {
  const codes = newRecoveryCodes((n) => randomBytes(n));
  const appUserId = session.context.actor.id;
  await replaceRecoveryCodes(
    deps.db(),
    { tenantId: session.context.tenantId, appUserId },
    codes.map((c) => hashRecoveryCode(c, appUserId)),
  );
  return codes;
}
