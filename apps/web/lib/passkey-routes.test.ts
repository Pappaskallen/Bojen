import { describe, expect, it, vi } from "vitest";
import {
  CHALLENGE_COOKIE,
  createPasskeyRoutes,
  openChallenge,
  relyingParty,
  sealChallenge,
  type PasskeyDeps,
} from "./passkey-routes";
import type { StaffSession } from "./staff-auth";

const NOW = new Date("2027-04-20T08:00:00Z");
const SECRET = "test-secret-that-is-long-enough-0123456789";
const session: StaffSession = {
  context: { tenantId: "t1", actor: { type: "staff", id: "u1" } },
  role: "mechanic",
  authUserId: "a1",
  aal: "aal1",
  factorIds: [],
  step: "none",
  accessToken: "token",
};

function deps(over: Partial<PasskeyDeps> = {}): PasskeyDeps {
  return {
    session: () => Promise.resolve(session),
    person: () => Promise.resolve({ name: "Elin", email: "elin@firma.test" }),
    passkeysOf: () => Promise.resolve([]),
    addPasskey: vi.fn(() => Promise.resolve("p1")),
    passkeyOwner: () => Promise.resolve(null),
    passkeyUsed: vi.fn(() => Promise.resolve()),
    sessionFor: vi.fn(() => Promise.resolve(null)),
    secret: () => SECRET,
    now: () => NOW,
    secure: false,
    ...over,
  };
}

const request = (path: string, headers: Record<string, string>, body?: unknown) =>
  new Request(`http://localhost:3100${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const browser = { host: "localhost:3100", origin: "http://localhost:3100" };

describe("the relying party", () => {
  it("is the host the browser is on, when the origin agrees", () => {
    expect(relyingParty(request("/", browser))).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3100",
    });
  });

  it("refuses an origin from another site, or none", () => {
    expect(
      relyingParty(request("/", { host: "localhost:3100", origin: "https://ond.example" })),
    ).toBeNull();
    expect(relyingParty(request("/", { host: "localhost:3100" }))).toBeNull();
    expect(
      relyingParty(request("/", { host: "localhost:3100", origin: "inte en adress" })),
    ).toBeNull();
  });
});

describe("the challenge cookie", () => {
  const challenge = { c: "abc", p: "login" as const, exp: NOW.getTime() / 1000 + 300 };

  it("comes back as it was sealed", () => {
    expect(openChallenge(SECRET, sealChallenge(SECRET, challenge), NOW)).toEqual(challenge);
  });

  it("is refused when changed, signed with another key, or old", () => {
    const sealed = sealChallenge(SECRET, challenge);
    const [body, mac] = sealed.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...challenge, c: "x" })).toString("base64url")}.${mac ?? ""}`;
    expect(openChallenge(SECRET, forged, NOW)).toBeNull();
    expect(openChallenge("another-secret-0123456789-0123456789", sealed, NOW)).toBeNull();
    expect(openChallenge(SECRET, `${body ?? ""}.`, NOW)).toBeNull();
    expect(openChallenge(SECRET, sealed, new Date(NOW.getTime() + 301_000))).toBeNull();
    expect(openChallenge(SECRET, null, NOW)).toBeNull();
  });
});

describe("the passkey routes", () => {
  it("give registration options only to someone signed in, with a short challenge cookie", async () => {
    const routes = createPasskeyRoutes(deps());
    const response = await routes.registerStart(request("/api/passkey/registrera/start", browser));
    expect(response.status).toBe(200);
    const options = (await response.json()) as {
      rp: { id: string };
      authenticatorSelection: { userVerification: string };
      extensions: { prf: unknown };
    };
    expect(options.rp.id).toBe("localhost");
    expect(options.authenticatorSelection.userVerification).toBe("required");
    expect(options.extensions.prf).toEqual({});
    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(
        `^${CHALLENGE_COOKIE}=[^;]+; Path=/api/passkey; HttpOnly; SameSite=Strict; Max-Age=300$`,
      ),
    );

    const signedOut = createPasskeyRoutes(deps({ session: () => Promise.resolve(null) }));
    expect((await signedOut.registerStart(request("/", browser))).status).toBe(401);
  });

  it("refuse to finish without the challenge from the start", async () => {
    const routes = createPasskeyRoutes(deps());
    const response = await routes.registerFinish(request("/", browser, { response: {} }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "challenge_expired" });
    const login = await routes.loginFinish(request("/", browser, { response: { id: "x" } }));
    expect(login.status).toBe(400);
  });

  it("make no session for a passkey nobody has", async () => {
    const d = deps();
    const routes = createPasskeyRoutes(d);
    const start = await routes.loginStart(request("/", browser));
    const cookie = (start.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const finish = await routes.loginFinish(
      request("/", { ...browser, cookie }, { response: { id: "unknown", response: {} } }),
    );
    expect(finish.status).toBe(401);
    expect(d.sessionFor).not.toHaveBeenCalled();
  });

  it("refuse a request from another site", async () => {
    const routes = createPasskeyRoutes(deps());
    const evil = { host: "localhost:3100", origin: "https://ond.example" };
    expect((await routes.loginStart(request("/", evil))).status).toBe(400);
    expect((await routes.registerStart(request("/", evil))).status).toBe(400);
  });
});
