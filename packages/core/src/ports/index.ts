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
}
