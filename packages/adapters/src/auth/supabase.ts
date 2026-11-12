import type { AuthSession, StaffAuth, StaffClaims } from "@bojen/core";

export interface SupabaseAuthOptions {
  /** `NEXT_PUBLIC_SUPABASE_URL`. */
  url: string;
  /** `NEXT_PUBLIC_SUPABASE_ANON_KEY`, sent as `apikey`. */
  anonKey: string;
  /** `SUPABASE_SERVICE_ROLE_KEY`, only for creating users. Server only. */
  serviceRoleKey: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

const ROLES = ["owner", "admin", "mechanic"] as const;

function decodeClaims(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/**
 * Supabase Auth (GoTrue) over its REST API: one-time codes by e-mail for staff. Sign-up is
 * off; users are created here with the service key when a known staff member asks for a code.
 * Tokens are checked against Auth itself (`/user`), which also catches revoked sessions.
 * Neither codes, tokens nor e-mail addresses are put in error messages.
 */
export function createSupabaseAuth(options: SupabaseAuthOptions): StaffAuth {
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const base = `${options.url.replace(/\/+$/, "")}/auth/v1`;
  const json = { "Content-Type": "application/json" };
  const anon = { apikey: options.anonKey };
  const admin = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
  };

  const session = (body: TokenResponse): AuthSession | null =>
    body.access_token && body.refresh_token && typeof body.expires_in === "number"
      ? {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: new Date(now().getTime() + body.expires_in * 1000),
        }
      : null;

  async function findUser(email: string): Promise<string | null> {
    for (let page = 1; page <= 20; page++) {
      const response = await send(`${base}/admin/users?page=${String(page)}&per_page=200`, {
        headers: admin,
      });
      if (!response.ok) throw new Error(`Supabase Auth answered ${String(response.status)}`);
      const body = (await response.json()) as { users?: { id: string; email?: string }[] };
      const users = body.users ?? [];
      const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (match) return match.id;
      if (users.length < 200) return null;
    }
    return null;
  }

  return {
    async ensureUser(email) {
      const response = await send(`${base}/admin/users`, {
        method: "POST",
        headers: { ...admin, ...json },
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (response.ok) return ((await response.json()) as { id: string }).id;
      if (response.status === 422) {
        const existing = await findUser(email);
        if (existing) return existing;
      }
      throw new Error(`Supabase Auth could not create the user: ${String(response.status)}`);
    },

    async sendCode(email) {
      const response = await send(`${base}/otp`, {
        method: "POST",
        headers: { ...anon, ...json },
        body: JSON.stringify({ email, create_user: false }),
      });
      if (!response.ok)
        throw new Error(`Supabase Auth could not send the code: ${String(response.status)}`);
    },

    async verifyCode(email, code) {
      const response = await send(`${base}/verify`, {
        method: "POST",
        headers: { ...anon, ...json },
        body: JSON.stringify({ type: "email", email, token: code.trim() }),
      });
      if (!response.ok) return null;
      return session((await response.json()) as TokenResponse);
    },

    async refresh(refreshToken) {
      const response = await send(`${base}/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { ...anon, ...json },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) return null;
      return session((await response.json()) as TokenResponse);
    },

    async claims(accessToken): Promise<StaffClaims | null> {
      const response = await send(`${base}/user`, {
        headers: { ...anon, Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;
      const user = (await response.json()) as { id?: string };
      const claims = decodeClaims(accessToken);
      if (!user.id || !claims || claims.sub !== user.id) return null;
      const role = ROLES.find((r) => r === claims.app_role) ?? null;
      return {
        authUserId: user.id,
        tenantId: typeof claims.tenant_id === "string" ? claims.tenant_id : null,
        appUserId: typeof claims.app_user_id === "string" ? claims.app_user_id : null,
        role,
      };
    },

    async signOut(accessToken) {
      await send(`${base}/logout?scope=local`, {
        method: "POST",
        headers: { ...anon, Authorization: `Bearer ${accessToken}` },
      });
    },
  };
}
