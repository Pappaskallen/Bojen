import { randomBytes } from "node:crypto";
import {
  createFakeGeocoder,
  createFakeMaps,
  createFakeSms,
  createFakeStorage,
  createOsrmMaps,
  createPhotonGeocoder,
  createSupabaseStorage,
} from "@bojen/adapters";
import type { Geocoder, MapsProvider, ObjectStorage, SmsSender } from "@bojen/core";
import { connect, type DbConnection } from "@bojen/db";
import { createBookingRoutes, type RequestContext } from "./bookings";
import { createPublicRoutes } from "./public-booking";

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

/**
 * The signed-in staff member, or null. Staff sign-in with Supabase Auth is step 2.7; until
 * then nobody is signed in, so the staff routes answer 401 and the staff pages ask for
 * sign-in. This is the one place step 2.7 connects.
 */
export function currentStaff(): Promise<RequestContext | null> {
  return Promise.resolve(null);
}

export const bookingRoutes = createBookingRoutes({
  db,
  now: () => new Date(),
  authorize: () => currentStaff(),
});

function once<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/**
 * Real sms comes with 46elks in step 3.1. Until then codes are only written to the server
 * console during development, and production refuses to send.
 */
const sms = once<SmsSender>(() => {
  if (production) {
    return {
      send: () => Promise.reject(new Error("No sms provider is configured (step 3.1)")),
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

export const publicRoutes = createPublicRoutes({
  db,
  sms,
  maps,
  geocoder,
  storage,
  now: () => new Date(),
  sessionSecret,
});
