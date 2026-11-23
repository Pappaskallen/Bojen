import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, isStaffPath, middleware } from "../middleware";

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
      "/forfragningar",
      "/sakerhet",
      "/kunder/abc",
      "/batar/abc",
      "/marinor",
      "/pipeline",
      "/kampanjer/abc",
      "/idag",
      "/oversikt/samtal",
      "/api/idag/x",
      "/api/passkey/x",
      "/api/pipeline/x",
      "/api/kampanjer/x",
      "/api/bookings/x",
      "/api/staff/x",
      "/api/batar/x",
      "/api/fakturaunderlag",
    ]) {
      expect(isStaffPath(path), path).toBe(true);
    }
    for (const path of ["/", "/boka/firma", "/logga-in", "/kunderna", "/api/webhooks/elks"]) {
      expect(isStaffPath(path), path).toBe(false);
    }
  });

  it("runs on every page but not on static files", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"]);
  });
});

describe("content security policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends a policy with a fresh nonce, and puts it in the request for Next.js", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const a = await middleware(new NextRequest("http://127.0.0.1:3100/boka/firma"));
    const b = await middleware(new NextRequest("http://127.0.0.1:3100/logga-in"));
    const pa = a.headers.get("content-security-policy") ?? "";
    const pb = b.headers.get("content-security-policy") ?? "";
    expect(pa).toMatch(/script-src .self. .nonce-[A-Za-z0-9+/=]+. .strict-dynamic./);
    expect(pa).not.toContain("frame-ancestors");
    expect(pb).toContain("frame-ancestors 'none'");
    expect(pa.match(/nonce-[^']+/)?.[0]).not.toBe(pb.match(/nonce-[^']+/)?.[0]);
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(pa);
  });
});
