import type { AuthSession, StaffAuth, StaffClaims } from "@bojen/core";

export interface FakeAuth extends StaffAuth {
  /** The code most recently sent to an e-mail address. */
  codeFor(email: string): string | undefined;
  /** Who each auth user is in the firm; the fake's stand-in for the access-token hook. */
  link(authUserId: string, staff: Omit<StaffClaims, "authUserId">): void;
  readonly users: Map<string, string>;
}

/** Auth in memory for tests: codes are 123456 plus a counter, tokens are random strings. */
export function createFakeAuth(): FakeAuth {
  const users = new Map<string, string>(); // email → auth user id
  const codes = new Map<string, string>(); // email → code
  const tokens = new Map<string, string>(); // access or refresh token → auth user id
  const staff = new Map<string, Omit<StaffClaims, "authUserId">>();
  let counter = 0;

  const issue = (userId: string): AuthSession => {
    const accessToken = `access-${crypto.randomUUID()}`;
    const refreshToken = `refresh-${crypto.randomUUID()}`;
    tokens.set(accessToken, userId);
    tokens.set(refreshToken, userId);
    return { accessToken, refreshToken, expiresAt: new Date(Date.now() + 3_600_000) };
  };

  return {
    users,
    codeFor: (email) => codes.get(email.toLowerCase()),
    link: (authUserId, claims) => staff.set(authUserId, claims),
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
      return Promise.resolve(issue(userId));
    },
    refresh(refreshToken) {
      const userId = refreshToken.startsWith("refresh-") ? tokens.get(refreshToken) : undefined;
      if (!userId) return Promise.resolve(null);
      tokens.delete(refreshToken);
      return Promise.resolve(issue(userId));
    },
    claims(accessToken) {
      const userId = accessToken.startsWith("access-") ? tokens.get(accessToken) : undefined;
      if (!userId) return Promise.resolve(null);
      const linked = staff.get(userId) ?? { tenantId: null, appUserId: null, role: null };
      return Promise.resolve({ authUserId: userId, ...linked });
    },
    signOut(accessToken) {
      tokens.delete(accessToken);
      return Promise.resolve();
    },
  };
}
