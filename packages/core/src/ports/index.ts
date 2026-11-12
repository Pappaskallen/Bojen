import type { GeoPoint } from "../scheduling/travel";

/** Sends one sms. 46elks in production (phase 3), a fake in tests. */
export interface SmsSender {
  send(message: { to: string; body: string }): Promise<{ id: string }>;
}

export interface GeocodeResult {
  /** For example `Bryggvägen 12, Värmdö`. */
  label: string;
  position: GeoPoint;
}

/** Address search for the booking page. Photon (OpenStreetMap) in production. */
export interface Geocoder {
  search(query: string, options?: { near?: GeoPoint; limit?: number }): Promise<GeocodeResult[]>;
}

/** Files such as pictures of the drive. Supabase Storage in production. */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/** A signed-in session from the auth provider. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Who a valid access token belongs to, from the claims the access-token hook adds. */
export interface StaffClaims {
  authUserId: string;
  /** Empty when the user is not staff in any firm. */
  tenantId: string | null;
  appUserId: string | null;
  role: "owner" | "admin" | "mechanic" | null;
  /** `aal2` after a second factor in this session (step 2.8). */
  aal: "aal1" | "aal2";
  /** Verified second factors (authenticator apps) of the user. */
  factorIds: string[];
}

/** A new authenticator-app factor, before the first code confirms it. */
export interface TotpEnrollment {
  factorId: string;
  /** The QR code as SVG markup. */
  qrSvg: string;
  /** The same secret as text, for apps that cannot scan. */
  secret: string;
}

/** Staff sign-in with a one-time code by e-mail (step 2.7). Supabase Auth in production. */
export interface StaffAuth {
  /** The auth user for this e-mail, created when missing. Returns its id. */
  ensureUser(email: string): Promise<string>;
  sendCode(email: string): Promise<void>;
  /** A session, or null when the code is wrong or expired. */
  verifyCode(email: string, code: string): Promise<AuthSession | null>;
  refresh(refreshToken: string): Promise<AuthSession | null>;
  /** The claims of a valid, unrevoked token, or null. */
  claims(accessToken: string): Promise<StaffClaims | null>;
  signOut(accessToken: string): Promise<void>;
  /** Starts adding an authenticator app for the signed-in user (step 2.8). */
  enrollTotp(accessToken: string): Promise<TotpEnrollment>;
  /** Checks a code from the app; a new session at `aal2`, or null when the code is wrong. */
  verifyTotp(accessToken: string, factorId: string, code: string): Promise<AuthSession | null>;
  /** Removes every second factor of a user, with the service key. */
  removeFactors(authUserId: string): Promise<void>;
  /** Whether the user has a verified second factor, with the service key. */
  hasFactor(authUserId: string): Promise<boolean>;
}
