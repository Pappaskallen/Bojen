import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "../middleware";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

const request = (cookie: string) =>
  new NextRequest("http://127.0.0.1:3100/forfragningar", { headers: { cookie } });

describe("session refresh middleware", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refreshes an expired access cookie with the refresh cookie", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(
        Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await middleware(request("bojen_refresh=old-refresh"));

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://supabase.test/auth/v1/token?grant_type=refresh_token",
    );
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("bojen_access=new-access;"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("bojen_refresh=new-refresh;"))).toBe(true);
  });

  it("leaves a valid session alone and clears a refused one", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("", { status: 400 })));
    vi.stubGlobal("fetch", fetch);

    const untouched = await middleware(request("bojen_access=still-valid; bojen_refresh=r"));
    expect(fetch).not.toHaveBeenCalled();
    expect(untouched.headers.getSetCookie()).toEqual([]);

    const refused = await middleware(request("bojen_refresh=revoked"));
    expect(refused.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))).toBe(true);
  });
});

describe("which paths refresh the session", () => {
  it("covers every staff page and route, also the customer and boat cards", () => {
    for (const path of [
      "/forfragningar/:path*",
      "/sakerhet/:path*",
      "/kunder/:path*",
      "/batar/:path*",
      "/api/bookings/:path*",
      "/api/staff/:path*",
      "/api/batar/:path*",
    ]) {
      expect(config.matcher).toContain(path);
    }
  });
});
