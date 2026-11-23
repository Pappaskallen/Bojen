import { createFakeFortnox } from "@bojen/adapters";
import { describe, expect, it, vi } from "vitest";
import { FORTNOX_COOKIE, createFortnoxRoutes, type FortnoxRouteDeps } from "./fortnox-routes";
import type { StaffSession } from "./staff-auth";

const owner: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "owner",
  authUserId: "a1",
  aal: "aal2",
  factorIds: [],
  step: "none",
  accessToken: "token",
};
const mechanic: StaffSession = { ...owner, role: "mechanic" };
const REDIRECT = "https://bojen.test/api/integrationer/fortnox/callback";

function routes(over: Partial<FortnoxRouteDeps> = {}) {
  const fortnox = createFakeFortnox({ company: "Jonas Båtservice AB" });
  const deps: FortnoxRouteDeps = {
    session: () => Promise.resolve(owner),
    fortnox: () => fortnox,
    clientId: () => "cid",
    redirectUri: () => REDIRECT,
    secureCookies: true,
    save: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    saveSettings: vi.fn(() => Promise.resolve()),
    ...over,
  };
  return { deps, fortnox, r: createFortnoxRoutes(deps) };
}

const get = (path: string, cookie?: string) =>
  new Request(`https://bojen.test${path}`, cookie ? { headers: { cookie } } : {});

/** Starts a connection and returns the state and the cookie the browser keeps. */
async function start(r: ReturnType<typeof routes>["r"]) {
  const response = await r.connect(get("/api/integrationer/fortnox/koppla"));
  const location = new URL(response.headers.get("location") ?? "");
  const setCookie = response.headers.get("set-cookie") ?? "";
  return { response, location, setCookie, cookie: setCookie.split(";")[0] ?? "" };
}

describe("connecting Fortnox", () => {
  it("sends the owner to Fortnox with state and PKCE, in a cookie only these routes see", async () => {
    const { r } = routes();
    const { response, location, setCookie } = await start(r);
    expect(response.status).toBe(303);
    expect(location.origin).toBe("https://apps.fortnox.se");
    expect(location.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(setCookie).toContain(`${FORTNOX_COOKIE}=`);
    expect(setCookie).toContain("Path=/api/integrationer/fortnox");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Max-Age=600");
  });

  it("stores the connection when the state matches, with the company name", async () => {
    const { r, deps } = routes();
    const { location, cookie } = await start(r);
    const state = location.searchParams.get("state") ?? "";
    const done = await r.callback(
      get(`/api/integrationer/fortnox/callback?code=good-code&state=${state}`, cookie),
    );
    expect(done.headers.get("location")).toBe("/installningar/integrationer?fortnox=kopplad");
    expect(done.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(deps.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        companyName: "Jonas Båtservice AB",
        connectedBy: "u1",
      }),
    );
  });

  it("refuses a callback with another state, without the cookie, or after a no", async () => {
    const { r, deps } = routes();
    const { cookie } = await start(r);
    const forged = await r.callback(
      get("/api/integrationer/fortnox/callback?code=good-code&state=other", cookie),
    );
    expect(forged.headers.get("location")).toContain("fortnox=fel");
    const noCookie = await r.callback(
      get("/api/integrationer/fortnox/callback?code=good-code&state=x"),
    );
    expect(noCookie.headers.get("location")).toContain("fortnox=fel");
    const refused = await r.callback(
      get("/api/integrationer/fortnox/callback?error=access_denied&state=x", cookie),
    );
    expect(refused.headers.get("location")).toContain("fortnox=nekad");
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("is closed to mechanics, and says so when the app is not registered yet", async () => {
    const closed = routes({ session: () => Promise.resolve(mechanic) }).r;
    expect((await closed.connect(get("/api/integrationer/fortnox/koppla"))).status).toBe(403);
    const unregistered = routes({ clientId: () => null }).r;
    const response = await unregistered.connect(get("/api/integrationer/fortnox/koppla"));
    expect(response.headers.get("location")).toContain("fortnox=ej-registrerad");
  });

  it("saves the article numbers and refuses bad ones", async () => {
    const { r, deps } = routes();
    const form = (fields: Record<string, string>) => {
      const body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.set(k, v);
      return new Request("https://bojen.test/api/integrationer/fortnox/installningar", {
        method: "POST",
        body,
      });
    };
    const ok = await r.settings(
      form({ artikel_labour: "101", artikel_part: "", forfallodagar: "30" }),
    );
    expect(ok.headers.get("location")).toContain("fortnox=sparad");
    expect(deps.saveSettings).toHaveBeenCalledWith("t1", {
      articles: { labour: "101" },
      dueDays: 30,
    });
    const bad = await r.settings(form({ artikel_labour: "1 0 1" }));
    expect(bad.headers.get("location")).toContain("fortnox=ogiltig-artikel");
  });
});
