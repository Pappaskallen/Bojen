import { createSupabaseAuth } from "@bojen/adapters";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, framesAllowed, newNonce } from "./lib/csp";
import { ACCESS_COOKIE, REFRESH_COOKIE, sessionCookies } from "./lib/session-cookies";

/** The staff pages and routes, where the session is kept alive (byggplan step 2.7). */
const STAFF_PATHS = [
  "/forfragningar",
  "/sakerhet",
  "/kunder",
  "/batar",
  "/marinor",
  "/pipeline",
  "/kampanjer",
  "/idag",
  "/oversikt",
  "/logga-in/tvafaktor",
  "/api/bookings",
  "/api/staff",
  "/api/batar",
  "/api/pipeline",
  "/api/kampanjer",
  "/api/kunder",
  "/api/idag",
  "/api/passkey",
  "/api/auth",
  "/api/fakturaunderlag",
  "/installningar",
  "/api/integrationer",
];

export const isStaffPath = (pathname: string) =>
  STAFF_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Two jobs on every page and route:
 *
 * - The Content Security Policy with a fresh nonce (ASVS V14.4). The policy also goes in the
 *   request, where Next.js reads the nonce and puts it on its own scripts. Off in development,
 *   where hot reload needs eval.
 * - The staff session (step 2.7). The access cookie expires a minute before its token; when it
 *   is gone and the refresh cookie is still there, the session is refreshed here, before the
 *   page or route reads it.
 */
export async function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  let policy: string | null = null;
  if (process.env.NODE_ENV !== "development") {
    policy = contentSecurityPolicy(newNonce(), framesAllowed(request.nextUrl.pathname));
    headers.set("content-security-policy", policy);
  }

  const cookies: string[] = [];
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (isStaffPath(request.nextUrl.pathname) && !request.cookies.get(ACCESS_COOKIE) && refreshToken)
    cookies.push(...(await refresh(request, refreshToken)));
  // The refreshed cookies are in the request now; carry them into the page's headers.
  headers.set("cookie", request.headers.get("cookie") ?? "");

  const response = NextResponse.next({ request: { headers } });
  if (policy) response.headers.set("Content-Security-Policy", policy);
  for (const header of cookies) response.headers.append("Set-Cookie", header);
  return response;
}

async function refresh(request: NextRequest, refreshToken: string): Promise<string[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return [];
  const now = new Date();
  const secure = process.env.NODE_ENV === "production" && !process.env.BOJEN_FAKE_SERVICES;
  const session = await createSupabaseAuth({ url, anonKey, serviceRoleKey }).refresh(refreshToken);
  if (session) request.cookies.set(ACCESS_COOKIE, session.accessToken);
  else request.cookies.delete(REFRESH_COOKIE);
  return sessionCookies(session, now, secure);
}

export const config = {
  // Everything but Next's static files and files with an extension (sw.js, widget.js, icons).
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
  runtime: "nodejs",
};
