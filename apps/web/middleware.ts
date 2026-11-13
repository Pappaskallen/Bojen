import { createSupabaseAuth } from "@bojen/adapters";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, sessionCookies } from "./lib/session-cookies";

/**
 * Keeps the staff session alive (byggplan step 2.7). The access cookie expires a minute
 * before its token; when it is gone and the refresh cookie is still there, the session is
 * refreshed here, before the page or route reads it.
 */
export async function middleware(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (request.cookies.get(ACCESS_COOKIE) || !refreshToken) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return NextResponse.next();

  const now = new Date();
  const secure = process.env.NODE_ENV === "production" && !process.env.BOJEN_FAKE_SERVICES;
  const session = await createSupabaseAuth({ url, anonKey, serviceRoleKey }).refresh(refreshToken);
  if (session) request.cookies.set(ACCESS_COOKIE, session.accessToken);
  else request.cookies.delete(REFRESH_COOKIE);

  const response = NextResponse.next({ request: { headers: request.headers } });
  for (const header of sessionCookies(session, now, secure))
    response.headers.append("Set-Cookie", header);
  return response;
}

export const config = {
  matcher: [
    "/forfragningar/:path*",
    "/sakerhet/:path*",
    "/kunder/:path*",
    "/batar/:path*",
    "/marinor/:path*",
    "/pipeline/:path*",
    "/idag/:path*",
    "/logga-in/tvafaktor",
    "/api/bookings/:path*",
    "/api/staff/:path*",
    "/api/batar/:path*",
    "/api/pipeline/:path*",
    "/api/idag/:path*",
    "/api/auth/:path*",
  ],
  runtime: "nodejs",
};
