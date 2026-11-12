import { describe, expect, it } from "vitest";
import { createFakeAuth } from "./fake";
import { createSupabaseAuth } from "./supabase";

const NOW = new Date("2027-04-01T08:00:00Z");

/** A token with the given claims; the signature is not checked here, Auth checks it. */
const token = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

function recordingFetch(answer: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(answer(call.url, call.init));
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const options = {
  url: "http://supabase.test/",
  anonKey: "anon",
  serviceRoleKey: "service",
  now: () => NOW,
};

describe("Supabase auth", () => {
  it("sends a code without creating users and verifies it into a session", async () => {
    const { fetch, calls } = recordingFetch((url) =>
      url.endsWith("/verify")
        ? Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600 })
        : Response.json({}),
    );
    const auth = createSupabaseAuth({ ...options, fetch });

    await auth.sendCode("jonas@firma.test");
    const session = await auth.verifyCode("jonas@firma.test", " 123456 ");

    expect(calls[0]?.url).toBe("http://supabase.test/auth/v1/otp");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: "jonas@firma.test",
      create_user: false,
    });
    expect((calls[0]?.init.headers as Record<string, string>).apikey).toBe("anon");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      type: "email",
      email: "jonas@firma.test",
      token: "123456",
    });
    expect(session).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date("2027-04-01T09:00:00Z"),
    });
  });

  it("answers null to a wrong code or a refused refresh", async () => {
    const { fetch } = recordingFetch(() =>
      Response.json({ error: "otp_expired" }, { status: 403 }),
    );
    const auth = createSupabaseAuth({ ...options, fetch });
    expect(await auth.verifyCode("jonas@firma.test", "000000")).toBeNull();
    expect(await auth.refresh("old")).toBeNull();
  });

  it("creates users with the service key, and finds them when they exist already", async () => {
    const { fetch, calls } = recordingFetch((url, init) => {
      if (url.endsWith("/admin/users") && init.method === "POST") {
        return Response.json({ code: "email_exists" }, { status: 422 });
      }
      return Response.json({ users: [{ id: "u-1", email: "Jonas@Firma.test" }] });
    });
    const auth = createSupabaseAuth({ ...options, fetch });
    expect(await auth.ensureUser("jonas@firma.test")).toBe("u-1");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer service");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: "jonas@firma.test",
      email_confirm: true,
    });
  });

  it("reads the firm and role from a token that Auth accepts", async () => {
    const access = token({
      sub: "u-1",
      tenant_id: "t-1",
      app_user_id: "a-1",
      app_role: "mechanic",
    });
    const { fetch, calls } = recordingFetch(() => Response.json({ id: "u-1" }));
    const auth = createSupabaseAuth({ ...options, fetch });
    expect(await auth.claims(access)).toEqual({
      authUserId: "u-1",
      tenantId: "t-1",
      appUserId: "a-1",
      role: "mechanic",
    });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${access}`,
    );
  });

  it("refuses tokens that Auth rejects or that belong to someone else", async () => {
    const rejected = createSupabaseAuth({
      ...options,
      fetch: recordingFetch(() => new Response("", { status: 401 })).fetch,
    });
    expect(await rejected.claims(token({ sub: "u-1", tenant_id: "t-1" }))).toBeNull();

    const other = createSupabaseAuth({
      ...options,
      fetch: recordingFetch(() => Response.json({ id: "u-2" })).fetch,
    });
    expect(await other.claims(token({ sub: "u-1", tenant_id: "t-1" }))).toBeNull();
  });
});

describe("fake auth", () => {
  it("only sends codes to known users and uses each code once", async () => {
    const auth = createFakeAuth();
    await auth.sendCode("okand@firma.test");
    expect(auth.codeFor("okand@firma.test")).toBeUndefined();

    const id = await auth.ensureUser("jonas@firma.test");
    auth.link(id, { tenantId: "t-1", appUserId: "a-1", role: "owner" });
    await auth.sendCode("jonas@firma.test");
    const code = auth.codeFor("jonas@firma.test") ?? "";
    const session = await auth.verifyCode("jonas@firma.test", code);
    expect(session).not.toBeNull();
    expect(await auth.verifyCode("jonas@firma.test", code)).toBeNull();
    expect(await auth.claims(session?.accessToken ?? "")).toMatchObject({
      tenantId: "t-1",
      role: "owner",
    });
    await auth.signOut(session?.accessToken ?? "");
    expect(await auth.claims(session?.accessToken ?? "")).toBeNull();
  });
});
