import type { AuthSession, StaffAuth, StaffClaims } from "@bojen/core";

type Staff = Pick<StaffClaims, "tenantId" | "appUserId" | "role">;

export interface FakeAuth extends StaffAuth {
  /** The code most recently sent to an e-mail address or, by sms, a phone number. */
  codeFor(emailOrPhone: string): string | undefined;
  /** The code the fake authenticator app shows for a factor. */
  totpFor(factorId: string): string | undefined;
  /** Who each auth user is in the firm; the fake's stand-in for the access-token hook. */
  link(authUserId: string, staff: Staff): void;
  /** Ends every session of a user, like deleting their rows in `auth.sessions`. */
  revokeAll(authUserId: string): void;
  readonly users: Map<string, string>;
}

interface Token {
  userId: string;
  aal: "aal1" | "aal2";
  kind: "access" | "refresh";
}

/**
 * Auth in memory for tests: e-mail and sms codes are 123456 plus a counter, tokens are random
 * strings, and each authenticator factor accepts one fixed six-digit code.
 */
export function createFakeAuth(): FakeAuth {
  const users = new Map<string, string>(); // email → auth user id
  const codes = new Map<string, string>(); // email or phone → code
  const phones = new Map<string, string>(); // phone → auth user id
  const tokens = new Map<string, Token>();
  const staff = new Map<string, Staff>();
  const factors = new Map<string, { userId: string; code: string; verified: boolean }>();
  let counter = 0;

  const issue = (userId: string, aal: Token["aal"]): AuthSession => {
    const accessToken = `access-${crypto.randomUUID()}`;
    const refreshToken = `refresh-${crypto.randomUUID()}`;
    tokens.set(accessToken, { userId, aal, kind: "access" });
    tokens.set(refreshToken, { userId, aal, kind: "refresh" });
    return { accessToken, refreshToken, expiresAt: new Date(Date.now() + 3_600_000) };
  };
  const access = (token: string) => {
    const t = tokens.get(token);
    return t?.kind === "access" ? t : undefined;
  };
  const verifiedOf = (userId: string) =>
    [...factors].filter(([, f]) => f.userId === userId && f.verified).map(([id]) => id);

  return {
    users,
    codeFor: (email) => codes.get(email.toLowerCase()),
    totpFor: (factorId) => factors.get(factorId)?.code,
    link: (authUserId, claims) => staff.set(authUserId, claims),
    revokeAll(authUserId) {
      for (const [token, t] of tokens) if (t.userId === authUserId) tokens.delete(token);
    },
    ensureUser(email) {
      const key = email.toLowerCase();
      const id = users.get(key) ?? crypto.randomUUID();
      users.set(key, id);
      return Promise.resolve(id);
    },
    sendCode(email) {
      const key = email.toLowerCase();
      if (users.has(key)) codes.set(key, String(123_456 + counter++));
      return Promise.resolve();
    },
    verifyCode(email, code) {
      const key = email.toLowerCase();
      const userId = users.get(key);
      if (!userId || codes.get(key) !== code.trim()) return Promise.resolve(null);
      codes.delete(key);
      return Promise.resolve(issue(userId, "aal1"));
    },
    setPhone(authUserId, phone) {
      phones.set(phone, authUserId);
      return Promise.resolve();
    },
    sendSmsCode(phone) {
      if (phones.has(phone)) codes.set(phone, String(123_456 + counter++));
      return Promise.resolve();
    },
    verifySmsCode(phone, code) {
      const userId = phones.get(phone);
      if (!userId || codes.get(phone) !== code.trim()) return Promise.resolve(null);
      codes.delete(phone);
      return Promise.resolve(issue(userId, "aal1"));
    },
    refresh(refreshToken) {
      const t = tokens.get(refreshToken);
      if (t?.kind !== "refresh") return Promise.resolve(null);
      tokens.delete(refreshToken);
      return Promise.resolve(issue(t.userId, t.aal));
    },
    claims(accessToken) {
      const t = access(accessToken);
      if (!t) return Promise.resolve(null);
      const linked = staff.get(t.userId) ?? { tenantId: null, appUserId: null, role: null };
      return Promise.resolve({
        authUserId: t.userId,
        ...linked,
        aal: t.aal,
        factorIds: verifiedOf(t.userId),
      });
    },
    signOut(accessToken) {
      tokens.delete(accessToken);
      return Promise.resolve();
    },
    enrollTotp(accessToken) {
      const t = access(accessToken);
      if (!t) return Promise.reject(new Error("Not signed in"));
      for (const [id, f] of factors) if (f.userId === t.userId && !f.verified) factors.delete(id);
      const factorId = crypto.randomUUID();
      const code = String(100_000 + Math.floor(Math.random() * 900_000));
      factors.set(factorId, { userId: t.userId, code, verified: false });
      return Promise.resolve({ factorId, qrSvg: "<svg></svg>", secret: `FAKE${code}` });
    },
    verifyTotp(accessToken, factorId, code) {
      const t = access(accessToken);
      const factor = factors.get(factorId);
      if (!t || !factor || factor.userId !== t.userId || factor.code !== code.trim()) {
        return Promise.resolve(null);
      }
      factor.verified = true;
      return Promise.resolve(issue(t.userId, "aal2"));
    },
    removeFactors(authUserId) {
      for (const [id, f] of factors) if (f.userId === authUserId) factors.delete(id);
      return Promise.resolve();
    },
    hasFactor(authUserId) {
      return Promise.resolve(verifiedOf(authUserId).length > 0);
    },
  };
}
