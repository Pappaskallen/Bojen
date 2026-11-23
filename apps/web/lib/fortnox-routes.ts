/**
 * Connecting the firm's Fortnox (byggplan step 8): only the owner and administrators.
 *
 *   GET  /api/integrationer/fortnox/koppla     → 303 to Fortnox' consent page
 *   GET  /api/integrationer/fortnox/callback   → back from Fortnox: stores the connection
 *   POST /api/integrationer/fortnox/koppla-fran → removes it
 *   POST /api/integrationer/fortnox/installningar  articles and due days
 *
 * The state and the PKCE verifier ride in a short-lived cookie that only these routes see,
 * so a callback that did not start here is refused. Every answer goes back to the settings
 * page with `?fortnox=…`.
 */
import { timingSafeEqual } from "node:crypto";
import type { FortnoxApi, FortnoxTokens } from "@bojen/core";
import { authorizeUrl, isArticleNumber, newAuthorization } from "@bojen/core/fortnox";
import type { InvoiceLineType } from "@bojen/core";
import { logError } from "./errors";
import type { StaffSession } from "./staff-auth";

export interface FortnoxRouteDeps {
  session: (request: Request) => Promise<StaffSession | null>;
  /** Null until the app is registered with Fortnox. */
  fortnox: () => FortnoxApi | null;
  clientId: () => string | null;
  /** `https://bojen.se/api/integrationer/fortnox/callback`. */
  redirectUri: () => string;
  secureCookies: boolean;
  save: (input: {
    tenantId: string;
    tokens: FortnoxTokens;
    companyName: string | null;
    connectedBy: string;
  }) => Promise<void>;
  disconnect: (tenantId: string) => Promise<void>;
  saveSettings: (
    tenantId: string,
    settings: { articles: Partial<Record<InvoiceLineType, string>>; dueDays: number },
  ) => Promise<void>;
}

export const FORTNOX_COOKIE = "bojen_fortnox";
const COOKIE_PATH = "/api/integrationer/fortnox";
const PAGE = "/installningar/integrationer";
const LINE_TYPES: readonly InvoiceLineType[] = [
  "labour",
  "callout",
  "emergency",
  "discount",
  "part",
];

const back = (result: string, cookies: string[] = []) => {
  const response = new Response(null, {
    status: 303,
    headers: { location: `${PAGE}?fortnox=${result}`, "Cache-Control": "no-store" },
  });
  for (const c of cookies) response.headers.append("Set-Cookie", c);
  return response;
};

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createFortnoxRoutes(deps: FortnoxRouteDeps) {
  const cookie = (value: string, maxAge: number) =>
    [
      `${FORTNOX_COOKIE}=${encodeURIComponent(value)}`,
      `Path=${COOKIE_PATH}`,
      `Max-Age=${String(maxAge)}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(deps.secureCookies ? ["Secure"] : []),
    ].join("; ");
  const clear = cookie("", 0);

  async function owner(request: Request) {
    const session = await deps.session(request);
    if (session?.step !== "none") return new Response(null, { status: 401 });
    if (session.role === "mechanic") return new Response(null, { status: 403 });
    return session;
  }

  return {
    async connect(request: Request): Promise<Response> {
      const session = await owner(request);
      if (session instanceof Response) return session;
      const clientId = deps.clientId();
      if (!clientId || !deps.fortnox()) return back("ej-registrerad");
      const a = newAuthorization();
      const response = new Response(null, {
        status: 303,
        headers: {
          location: authorizeUrl({
            clientId,
            redirectUri: deps.redirectUri(),
            state: a.state,
            challenge: a.challenge,
          }),
          "Cache-Control": "no-store",
        },
      });
      // Ten minutes, as long as Fortnox' authorization code lives.
      response.headers.append("Set-Cookie", cookie(`${a.state}.${a.verifier}`, 600));
      return response;
    },

    async callback(request: Request): Promise<Response> {
      const session = await owner(request);
      if (session instanceof Response) return session;
      const fortnox = deps.fortnox();
      const url = new URL(request.url);
      const [state, verifier] = (readCookie(request, FORTNOX_COOKIE) ?? "").split(".");
      const code = url.searchParams.get("code");
      const given = url.searchParams.get("state") ?? "";
      if (url.searchParams.get("error")) return back("nekad", [clear]);
      if (!fortnox || !code || !state || !verifier || !same(state, given))
        return back("fel", [clear]);
      try {
        const tokens = await fortnox.exchangeCode({
          code,
          redirectUri: deps.redirectUri(),
          verifier,
        });
        const companyName = await fortnox.companyName(tokens.accessToken).catch(() => null);
        await deps.save({
          tenantId: session.context.tenantId,
          tokens,
          companyName,
          connectedBy: session.context.actor.id,
        });
        return back("kopplad", [clear]);
      } catch (error) {
        logError("fortnox callback", error);
        return back("fel", [clear]);
      }
    },

    async disconnect(request: Request): Promise<Response> {
      const session = await owner(request);
      if (session instanceof Response) return session;
      await deps.disconnect(session.context.tenantId);
      return back("bortkopplad");
    },

    async settings(request: Request): Promise<Response> {
      const session = await owner(request);
      if (session instanceof Response) return session;
      const form = await request.formData().catch(() => null);
      const articles: Partial<Record<InvoiceLineType, string>> = {};
      for (const type of LINE_TYPES) {
        const value = form?.get(`artikel_${type}`);
        if (typeof value !== "string" || !value.trim()) continue;
        if (!isArticleNumber(value.trim())) return back("ogiltig-artikel");
        articles[type] = value.trim();
      }
      const due = Number(form?.get("forfallodagar") ?? 10);
      if (!Number.isInteger(due) || due < 0 || due > 90) return back("ogiltiga-dagar");
      await deps.saveSettings(session.context.tenantId, { articles, dueDays: due });
      return back("sparad");
    },
  };
}
