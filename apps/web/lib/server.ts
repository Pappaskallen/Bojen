import { randomBytes } from "node:crypto";
import {
  createFakeGeocoder,
  createFakeMaps,
  createFakeSms,
  createFakeStorage,
  createOsrmMaps,
  createPhotonGeocoder,
  createSupabaseAuth,
  createSupabaseStorage,
  createClaudeClassifier,
  createFakeClassifier,
  elksFromEnv,
  kmsFromEnv,
} from "@bojen/adapters";
import type { Kms } from "@bojen/core/crypto";
import type {
  Geocoder,
  MapsProvider,
  ObjectStorage,
  ReplyClassifier,
  SmsSender,
  StaffAuth,
} from "@bojen/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connect, type DbConnection } from "@bojen/db";
import { createBookingRoutes, type RequestContext } from "./bookings";
import { createCustomerPage } from "./customer-page";
import { createPublicRoutes } from "./public-booking";
import { createStaffAdminRoutes } from "./staff-admin";
import { ELKS_IPS, createWebhookRoutes } from "./webhooks";
import {
  ACCESS_COOKIE,
  createStaffAuthRoutes,
  staffFromRequest,
  staffSession,
  type StaffSession,
} from "./staff-auth";

/**
 * Fakes (sms, storage, session secret) are only allowed outside production, or when
 * `BOJEN_FAKE_SERVICES=1` says so explicitly, as in the end-to-end tests.
 */
const production = process.env.NODE_ENV === "production" && process.env.BOJEN_FAKE_SERVICES !== "1";

let connection: DbConnection | undefined;

/** One connection pool per server process, opened on first use. */
export function db() {
  connection ??= connect();
  return connection.db;
}

function once<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/** Supabase Auth for staff sign-in (step 2.7). There is no fake outside tests. */
export const staffAuth = once<StaffAuth>(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase Auth is not configured (NEXT_PUBLIC_SUPABASE_URL and keys)");
  }
  return createSupabaseAuth({ url, anonKey, serviceRoleKey });
});

/** The signed-in staff member on a page, before or after the second factor, or null. */
export async function currentSession(): Promise<StaffSession | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
  return token ? staffSession(staffAuth(), token) : null;
}

/**
 * For staff pages: the complete session, or a redirect to whatever is missing: sign-in,
 * adding an authenticator app, or the code from it (step 2.8).
 */
export async function requireStaff(path: string): Promise<StaffSession> {
  const session = await currentSession();
  const next = `nasta=${encodeURIComponent(path)}`;
  if (!session) redirect(`/logga-in?${next}`);
  if (session.step === "enroll") redirect(`/sakerhet/tvafaktor?${next}`);
  if (session.step === "challenge") redirect(`/logga-in/tvafaktor?${next}`);
  return session;
}

/** Kept for callers that only need who it is; null unless the session is complete. */
export async function currentStaff(): Promise<RequestContext | null> {
  const session = await currentSession();
  return session?.step === "none" ? session.context : null;
}

export const bookingRoutes = createBookingRoutes({
  db,
  now: () => new Date(),
  authorize: (request) => staffFromRequest(staffAuth(), request),
});

export const staffAdminRoutes = createStaffAdminRoutes({ db, auth: staffAuth });

export const staffAuthRoutes = createStaffAuthRoutes({
  db,
  auth: staffAuth,
  now: () => new Date(),
  secure: process.env.NODE_ENV === "production" && !process.env.BOJEN_FAKE_SERVICES,
});

/**
 * Sms through 46elks (step 3.1) when it is configured. Otherwise, outside production, a fake
 * that writes the sms to the server console; production then refuses to send.
 */
const sms = once<SmsSender>(() => {
  const elks = elksFromEnv();
  if (elks) return elks;
  if (production) {
    return {
      send: () => Promise.reject(new Error("46elks is not configured (ELKS_API_USERNAME)")),
    };
  }
  const fake = createFakeSms();
  return {
    async send(message) {
      const sent = await fake.send(message);
      console.info(`[dev-sms] to ${message.to}: ${message.body}`);
      return sent;
    },
  };
});

const maps = once<MapsProvider>(() =>
  process.env.OSRM_URL ? createOsrmMaps({ baseUrl: process.env.OSRM_URL }) : createFakeMaps(),
);

const geocoder = once<Geocoder>(() =>
  process.env.PHOTON_URL
    ? createPhotonGeocoder({ baseUrl: process.env.PHOTON_URL })
    : createFakeGeocoder(),
);

const storage = once<ObjectStorage>(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return createSupabaseStorage({ url, serviceRoleKey: key, bucket: "attachments" });
  if (production) throw new Error("Supabase Storage is not configured");
  return createFakeStorage();
});

const sessionSecret = once(() => {
  const secret = process.env.BOOKING_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (production) throw new Error("BOOKING_SESSION_SECRET must be at least 32 characters");
  // Development only: a new secret per server start signs everyone out, which is fine.
  return randomBytes(32).toString("base64url");
});

/** `SHORT_LINK_KEY`, the same as the worker's: the short links' codes are hashed with it. */
const linkKey = once(() => {
  const key = process.env.SHORT_LINK_KEY;
  if (key && key.length >= 32) return key;
  if (production) throw new Error("SHORT_LINK_KEY must be at least 32 characters");
  return "development-only-short-link-key-not-secret";
});

/** AWS KMS in production, the local KMS otherwise (step 1.6). */
const kms = once<Kms>(() => kmsFromEnv(process.env, production));

export const customerPage = createCustomerPage({
  db,
  maps,
  kms,
  now: () => new Date(),
  linkKey,
});

export const publicRoutes = createPublicRoutes({
  db,
  sms,
  maps,
  geocoder,
  storage,
  now: () => new Date(),
  sessionSecret,
});

/**
 * Which addresses may call the 46elks webhooks: `ELKS_ALLOWED_IPS` (comma separated), or
 * 46elks' published ones in production. No check outside production unless the variable is set.
 */
function elksIps(): readonly string[] | null {
  const listed = process.env.ELKS_ALLOWED_IPS?.split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (listed && listed.length > 0) return listed;
  return production ? ELKS_IPS : null;
}

/** Claude Sonnet 5.5 for free-text replies when `ANTHROPIC_API_KEY` is set (step 3.2). */
const classifier = once<ReplyClassifier>(() => {
  if (process.env.ANTHROPIC_API_KEY) return createClaudeClassifier();
  // Without a key every free-text reply is unclear and becomes a task for a person.
  if (production) console.warn("[sms] ANTHROPIC_API_KEY is not set; free-text replies go to staff");
  return createFakeClassifier();
});

/** The key the STOPP list is hashed with; required in production. */
const optOutKey = once(() => {
  const key = process.env.SMS_OPT_OUT_KEY;
  if (key && key.length >= 32) return key;
  if (production) throw new Error("SMS_OPT_OUT_KEY must be at least 32 characters");
  return "development-only-opt-out-key-not-secret";
});

export const webhookRoutes = createWebhookRoutes({
  db,
  sms,
  now: () => new Date(),
  smsHookSecret: () => process.env.SUPABASE_AUTH_SMS_HOOK_SECRET,
  elksToken: () => process.env.ELKS_WEBHOOK_SECRET,
  elksIps,
  classifier,
  optOutKey,
});
