/**
 * Passkeys for staff (byggplan step 5.5c, spec 10.7): a sign-in without a code, and the key
 * that unlocks the day view and the codes kept on the phone.
 *
 *   POST /api/passkey/registrera/start   (signed in)  → options for the phone
 *   POST /api/passkey/registrera/klar    { response, name? }   → 200 { prf }
 *   POST /api/passkey/logga-in/start                  → options for the phone
 *   POST /api/passkey/logga-in/klar      { response }  → 204 with the session cookies
 *
 * The challenge lives in a short, signed cookie between the two halves. The relying party is
 * the host the browser is on, and the origin must be that host: a passkey made here only works
 * here. User verification (Face ID, fingerprint, PIN) is required every time.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthSession } from "@bojen/core";
import type { PasskeyOwner, StoredPasskey } from "@bojen/db";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { readCookie, sessionCookies } from "./session-cookies";
import type { StaffSession } from "./staff-auth";

export const CHALLENGE_COOKIE = "bojen_webauthn";
const CHALLENGE_SECONDS = 300;

export interface PasskeyDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  /** The signed-in person's name and e-mail, for the passkey's label on the phone. */
  person: (tenantId: string, appUserId: string) => Promise<{ name: string; email: string | null }>;
  passkeysOf: (tenantId: string, appUserId: string) => Promise<StoredPasskey[]>;
  addPasskey: (
    owner: { tenantId: string; appUserId: string },
    passkey: Omit<StoredPasskey, "id">,
  ) => Promise<string>;
  passkeyOwner: (credentialId: string) => Promise<PasskeyOwner | null>;
  passkeyUsed: (passkeyId: string, counter: number) => Promise<void>;
  sessionFor: (email: string) => Promise<AuthSession | null>;
  secret: () => string;
  now: () => Date;
  secure: boolean;
}

/** The host the browser is on, and its origin, from the request; null when they disagree. */
export function relyingParty(request: Request): { rpID: string; origin: string } | null {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.host !== host) return null;
  return { rpID: url.hostname, origin: url.origin };
}

type Challenge = { c: string; p: "register" | "login"; u?: string; exp: number };

function sign(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function sealChallenge(secret: string, challenge: Challenge): string {
  const body = Buffer.from(JSON.stringify(challenge)).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function openChallenge(secret: string, value: string | null, now: Date): Challenge | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Challenge;
    return typeof c.c === "string" && c.exp > now.getTime() / 1000 ? c : null;
  } catch {
    return null;
  }
}

const challengeCookie = (value: string, maxAge: number, secure: boolean) =>
  `${CHALLENGE_COOKIE}=${value}; Path=/api/passkey; HttpOnly; SameSite=Strict; Max-Age=${String(maxAge)}${secure ? "; Secure" : ""}`;

const json = (body: unknown, status = 200, cookies: string[] = []) => {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
};

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export function createPasskeyRoutes(deps: PasskeyDeps) {
  const take = (request: Request, purpose: Challenge["p"]) => {
    const c = openChallenge(
      deps.secret(),
      readCookie(request.headers.get("cookie"), CHALLENGE_COOKIE),
      deps.now(),
    );
    return c?.p === purpose ? c : null;
  };
  const clear = challengeCookie("", 0, deps.secure);

  return {
    async registerStart(request: Request): Promise<Response> {
      const session = await deps.session(request);
      const rp = relyingParty(request);
      if (session?.step !== "none") return json({ error: "unauthorized" }, 401);
      if (!rp) return json({ error: "bad_origin" }, 400);
      const userId = session.context.actor.id;
      const person = await deps.person(session.context.tenantId, userId);
      const existing = await deps.passkeysOf(session.context.tenantId, userId);
      const options = await generateRegistrationOptions({
        rpName: "Bojen",
        rpID: rp.rpID,
        userName: person.email ?? person.name,
        userDisplayName: person.name,
        userID: new TextEncoder().encode(userId),
        attestationType: "none",
        excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        // Ask for the PRF extension, which gives the phone a key for the stored codes.
        extensions: { prf: {} } as never,
      });
      const sealed = sealChallenge(deps.secret(), {
        c: options.challenge,
        p: "register",
        u: userId,
        exp: Math.floor(deps.now().getTime() / 1000) + CHALLENGE_SECONDS,
      });
      return json(options, 200, [challengeCookie(sealed, CHALLENGE_SECONDS, deps.secure)]);
    },

    async registerFinish(request: Request): Promise<Response> {
      const session = await deps.session(request);
      const rp = relyingParty(request);
      if (session?.step !== "none") return json({ error: "unauthorized" }, 401);
      if (!rp) return json({ error: "bad_origin" }, 400);
      const challenge = take(request, "register");
      if (!challenge || challenge.u !== session.context.actor.id) {
        return json({ error: "challenge_expired" }, 400, [clear]);
      }
      const body = await readJson(request);
      const response = body.response as RegistrationResponseJSON | undefined;
      if (!response || typeof response !== "object")
        return json({ error: "invalid_input" }, 400, [clear]);
      const verified = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.c,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      }).catch(() => null);
      if (!verified?.verified) return json({ error: "not_verified" }, 400, [clear]);
      const { credential } = verified.registrationInfo;
      const prf =
        (response.clientExtensionResults as { prf?: { enabled?: boolean } } | undefined)?.prf
          ?.enabled === true;
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) || null : null;
      await deps.addPasskey(
        { tenantId: session.context.tenantId, appUserId: session.context.actor.id },
        {
          credentialId: credential.id,
          publicKey: credential.publicKey,
          counter: credential.counter,
          transports: credential.transports ?? [],
          prf,
          name,
        },
      );
      return json({ ok: true, prf, credentialId: credential.id }, 200, [clear]);
    },

    async loginStart(request: Request): Promise<Response> {
      const rp = relyingParty(request);
      if (!rp) return json({ error: "bad_origin" }, 400);
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: "required",
        allowCredentials: [],
      });
      const sealed = sealChallenge(deps.secret(), {
        c: options.challenge,
        p: "login",
        exp: Math.floor(deps.now().getTime() / 1000) + CHALLENGE_SECONDS,
      });
      return json(options, 200, [challengeCookie(sealed, CHALLENGE_SECONDS, deps.secure)]);
    },

    async loginFinish(request: Request): Promise<Response> {
      const rp = relyingParty(request);
      if (!rp) return json({ error: "bad_origin" }, 400);
      const challenge = take(request, "login");
      if (!challenge) return json({ error: "challenge_expired" }, 400, [clear]);
      const body = await readJson(request);
      const response = body.response as AuthenticationResponseJSON | undefined;
      if (!response || typeof response.id !== "string")
        return json({ error: "invalid_input" }, 400, [clear]);
      const owner = await deps.passkeyOwner(response.id);
      if (!owner) return json({ error: "unknown_passkey" }, 401, [clear]);
      const verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.c,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: owner.passkey.credentialId,
          publicKey: owner.passkey.publicKey as Uint8Array<ArrayBuffer>,
          counter: owner.passkey.counter,
          transports: owner.passkey.transports,
        },
      }).catch(() => null);
      if (!verified?.verified) return json({ error: "not_verified" }, 401, [clear]);
      await deps.passkeyUsed(owner.passkey.id, verified.authenticationInfo.newCounter);
      const session = await deps.sessionFor(owner.email);
      if (!session) return json({ error: "no_session" }, 500, [clear]);
      return json({ ok: true }, 200, [clear, ...sessionCookies(session, deps.now(), deps.secure)]);
    },
  };
}
