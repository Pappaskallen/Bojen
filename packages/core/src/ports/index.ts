import type { ReplyIntent } from "../messaging/intent";
import type { QuestionKind } from "../messaging/routeInbound";
import type { GeoPoint } from "../scheduling/travel";
import type { ReportFacts } from "../reports/draft";

/**
 * Reads a free-text reply by sms that the rules could not (step 3.2). Claude Sonnet 5.5 in
 * production, a fake in tests. Gets only the reply and the kind of question, never who it is.
 * The answer is checked with `checkModelAnswer` before it is used.
 */
export interface ReplyClassifier {
  classify(input: {
    reply: string;
    question: QuestionKind;
    allowed: readonly ReplyIntent[];
  }): Promise<{ intent: string; confidence: number; rating?: number | null }>;
}

/** One outgoing sms. `from` is the firm's number or name; the adapter has a default. */
export interface OutgoingSms {
  to: string;
  body: string;
  from?: string;
}

/** Sends one sms. 46elks in production (step 3.1), a fake in tests. */
export interface SmsSender {
  send(message: OutgoingSms): Promise<{ id: string }>;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** For example `Jonas Båtservice <jonas@bojen.se>`; the adapter has a default. */
  from?: string;
  replyTo?: string;
}

/** Sends one e-mail. Mailgun (EU) in production, a fake in tests. */
export interface EmailSender {
  send(message: OutgoingEmail): Promise<{ id: string }>;
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
  /** A link that shows the file for `seconds`, for an `<img>` on a staff page. The bucket is private. */
  signedUrl(key: string, seconds: number): Promise<string>;
  /** The file itself, for the worker (a voice note to transcribe). */
  get(key: string): Promise<Uint8Array>;
}

/**
 * Writes the draft of the service report from what the visit recorded (step 5.5d): Claude
 * Sonnet 5.5, or a fake in tests. The answer is checked with `normaliseDraft` before use.
 */
export interface ReportWriter {
  /** Who writes, stored on the report: the model id, or `fake`. */
  readonly name: string;
  draft(facts: ReportFacts): Promise<unknown>;
}

/** The call's summary in five points from its transcript (step 6.3): Sonnet 5.5, or a fake. */
export interface CallSummarizer {
  readonly name: string;
  summarize(transcript: string): Promise<unknown>;
}

/** A type plate read from a picture (step 6.3): Sonnet 5.5 with vision, or a fake. */
export interface NameplateReader {
  readonly name: string;
  read(picture: { bytes: Uint8Array; contentType: string }): Promise<unknown>;
}

/** Speech to text in Swedish (step 5.5d): Azure sv-SE later, a fake until the account exists. */
export interface Transcriber {
  transcribe(audio: { bytes: Uint8Array; contentType: string }): Promise<string>;
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
  /**
   * A session for a user we have already identified another way, with the service key: after
   * a verified passkey (step 5.5c). Never call it without that proof.
   */
  sessionFor(email: string): Promise<AuthSession | null>;
  /** Gives the auth user this mobile number (E.164), with the service key (step 3.1). */
  setPhone(authUserId: string, phone: string): Promise<void>;
  /** A code by sms; Supabase Auth hands it to our sms hook, which sends it with 46elks. */
  sendSmsCode(phone: string): Promise<void>;
  verifySmsCode(phone: string, code: string): Promise<AuthSession | null>;
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

/** A staff member's browser that takes web push (`push_subscription`). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the push shows: the service worker turns it into a notification. */
export interface PushPayload {
  title: string;
  body: string;
  /** Opened when the notification is tapped, for example `/idag/arenden`. */
  url: string;
  /** Kept on screen until it is tapped, and with vibration, for urgent calls. */
  urgent: boolean;
  /** One notification per message: a newer one with the same tag replaces it. */
  tag: string;
}

/**
 * Web push to staff (byggplan step 6.4). VAPID through the browsers' push services in
 * production, a fake in tests. `gone` means the subscription no longer exists.
 */
export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<{ gone: boolean }>;
}
