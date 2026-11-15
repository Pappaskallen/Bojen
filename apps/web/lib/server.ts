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
  VoiceToolName,
} from "@bojen/core";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  addInvoiceLine,
  addPart,
  addPasskey,
  approveReport,
  addVisitPhoto,
  addVoiceNote,
  appUser,
  codesForPhone,
  changeBooking,
  connect,
  createSpringCampaign,
  moveCard,
  onceOnly,
  passkeyOwner,
  passkeysOf,
  passkeyUsed,
  recordHours,
  removeInvoiceLine,
  revealBoatAccess,
  saveNote,
  saveReport,
  setPartStatus,
  startCampaign,
  visitBoatPicture,
  visitDayFor,
  type DbConnection,
  avbokaBokning,
  avslutaSamtal,
  bekraftaKund,
  callContext,
  foreslaTider,
  hamtaBokningar,
  hittaKund,
  kopplaTillMekaniker,
  ombokaBokning,
  openCall,
  sattVantelista,
  skapaBokning,
  skapaMeddelande,
  skickaLank,
  startCall,
  stoppaInspelning,
  type CallRow,
  type VoiceDeps,
} from "@bojen/db";
import { createBookingRoutes, type RequestContext } from "./bookings";
import { createBoatAccessRoute } from "./boat-access";
import { createCampaignRoutes } from "./campaign-routes";
import { createBoatPictureRoute } from "./boat-picture-route";
import { createCustomerPage } from "./customer-page";
import { createCodesRoute } from "./codes-route";
import { createDayRoute } from "./day-route";
import { createPasskeyRoutes } from "./passkey-routes";
import { createPipelineRoute } from "./pipeline-route";
import { createVoiceToolsRoute } from "./voice-tools-route";
import { createReportRoute } from "./report-route";
import { createPublicRoutes } from "./public-booking";
import { createStaffAdminRoutes } from "./staff-admin";
import { ELKS_IPS, createWebhookRoutes } from "./webhooks";
import {
  ACCESS_COOKIE,
  createStaffAuthRoutes,
  sessionFromRequest,
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

export const maps = once<MapsProvider>(() =>
  process.env.OSRM_URL ? createOsrmMaps({ baseUrl: process.env.OSRM_URL }) : createFakeMaps(),
);

const geocoder = once<Geocoder>(() =>
  process.env.PHOTON_URL
    ? createPhotonGeocoder({ baseUrl: process.env.PHOTON_URL })
    : createFakeGeocoder(),
);

export const storage = once<ObjectStorage>(() => {
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

/** The mechanic's day view (step 5.5): start, done, hours, parts and pictures. */
export const dayRoute = createDayRoute({
  session: (request) => sessionFromRequest(staffAuth(), request),
  visitDay: (actor, visitId) => visitDayFor(db(), actor, visitId),
  start: async (actor, visitId, key) => {
    await changeBooking(
      { db: db(), now: () => new Date() },
      {
        tenantId: actor.tenantId,
        actor: { type: "staff", id: actor.userId },
        idempotencyKey: `idag:${key}`,
      },
      visitId,
      { event: "start" },
    );
  },
  complete: async (actor, visitId, key) => {
    await changeBooking(
      { db: db(), now: () => new Date() },
      {
        tenantId: actor.tenantId,
        actor: { type: "staff", id: actor.userId },
        idempotencyKey: `idag:${key}`,
      },
      visitId,
      { event: "complete" },
    );
  },
  // Each once per key, so a form the offline queue sends again is not done twice (step 5.5b).
  hours: async (actor, visitId, key, engineId, hours) => {
    await onceOnly(db(), actor.tenantId, key, `timmar:${visitId}`, (tx) =>
      recordHours(tx, actor, visitId, engineId, hours, new Date()),
    );
  },
  addPart: async (actor, visitId, key, input) => {
    await onceOnly(db(), actor.tenantId, key, `del:${visitId}`, async (tx) => {
      await addPart(tx, actor, visitId, input);
    });
  },
  partStatus: async (actor, visitId, key, jobPartId, status) => {
    await onceOnly(db(), actor.tenantId, key, `delstatus:${visitId}`, (tx) =>
      setPartStatus(tx, actor, visitId, jobPartId, status),
    );
  },
  photo: async (actor, visitId, key, photo) => {
    await onceOnly(db(), actor.tenantId, key, `bild:${visitId}`, async (tx) => {
      await addVisitPhoto({ db: tx, storage: storage() }, actor, visitId, photo);
    });
  },
  note: async (actor, visitId, key, note) => {
    await onceOnly(db(), actor.tenantId, key, `anteckning:${visitId}`, (tx) =>
      saveNote(tx, actor, visitId, note),
    );
  },
  voice: async (actor, visitId, key, audio) => {
    await onceOnly(db(), actor.tenantId, key, `rost:${visitId}`, async (tx) => {
      await addVoiceNote({ db: tx, storage: storage() }, actor, visitId, audio);
    });
  },
});

/** Passkeys for staff (step 5.5c): sign-in without a code, and the phone's key for codes. */
export const passkeyRoutes = createPasskeyRoutes({
  session: (request) => sessionFromRequest(staffAuth(), request),
  person: async (tenantId, appUserId) => {
    const [row] = await db()
      .select({ name: appUser.name, email: appUser.email })
      .from(appUser)
      .where(and(eq(appUser.tenantId, tenantId), eq(appUser.id, appUserId)));
    return { name: row?.name ?? "", email: row?.email ?? null };
  },
  passkeysOf: (tenantId, appUserId) => passkeysOf(db(), tenantId, appUserId),
  addPasskey: (owner, passkey) => addPasskey(db(), owner, passkey),
  passkeyOwner: (credentialId) => passkeyOwner(db(), credentialId),
  passkeyUsed: (passkeyId, counter) => passkeyUsed(db(), passkeyId, counter, new Date()),
  sessionFor: (email) => staffAuth().sessionFor(email),
  secret: sessionSecret,
  now: () => new Date(),
  secure: process.env.NODE_ENV === "production" && !process.env.BOJEN_FAKE_SERVICES,
});

/** The codes the phone keeps for a visit (step 5.5c), through the access rule. */
export const codesRoute = createCodesRoute({
  session: (request) => sessionFromRequest(staffAuth(), request),
  codes: (userId, visitId) =>
    codesForPhone({ db: db(), kms: kms(), now: () => new Date() }, userId, visitId),
});

/** The picture of the boat on the day view (step 5.5d). */
export const boatPictureRoute = createBoatPictureRoute({
  session: (request) => sessionFromRequest(staffAuth(), request),
  picture: (actor, visitId) => visitBoatPicture({ db: db(), storage: storage() }, actor, visitId),
});

/** The service report and the invoice basis (step 5.5d). */
export const reportRoute = createReportRoute({
  session: (request) => sessionFromRequest(staffAuth(), request),
  save: (actor, visitId, input) => saveReport(db(), actor, visitId, input),
  approve: (actor, visitId, input) =>
    approveReport({ db: db(), now: () => new Date() }, actor, visitId, input),
  addLine: (actor, visitId, line) => addInvoiceLine(db(), actor, visitId, line),
  removeLine: (actor, visitId, lineId) => removeInvoiceLine(db(), actor, visitId, lineId),
});

/** Moving cards on the pipeline (step 5.4). */
export const pipelineRoute = createPipelineRoute({
  session: (request) => sessionFromRequest(staffAuth(), request),
  move: (mover, jobId, to) => moveCard(db(), mover, jobId, to),
});

/** The public address of the app, without a trailing slash, for links staff share. */
export const appUrl = () => (process.env.APP_URL ?? "").replace(/\/+$/, "");

/** The code from the boat card (step 5.2): the rule and the log are in `revealBoatAccess`. */
export const boatAccessRoute = createBoatAccessRoute({
  authorize: (request) => staffFromRequest(staffAuth(), request),
  reveal: (userId, boatId) =>
    revealBoatAccess({ db: db(), kms: kms(), now: () => new Date() }, userId, boatId),
});

export const customerPage = createCustomerPage({
  db,
  maps,
  kms,
  now: () => new Date(),
  linkKey,
  storage,
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

/** The campaigns (step 5.6): drafts and starting them; the sending is the worker's. */
export const campaignRoutes = createCampaignRoutes({
  session: (request) => sessionFromRequest(staffAuth(), request),
  create: (tenantId, input) => createSpringCampaign(db(), tenantId, input),
  start: (tenantId, campaignId) =>
    startCampaign(
      { db: db(), now: () => new Date(), optOutKey: optOutKey() },
      tenantId,
      campaignId,
    ),
});

/** The spring campaign's recipients before it starts, for the draft's page. */
export const campaignOptOutKey = () => optOutKey();

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

/** `VOICE_TOOLS_SECRET`: signs the calls' tokens and the times offered in them (step 6.1). */
const voiceSecret = once(() => {
  const secret = process.env.VOICE_TOOLS_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (production) throw new Error("VOICE_TOOLS_SECRET must be at least 32 characters");
  // Development only: a new secret per server start ends every call's token, which is fine.
  return randomBytes(32).toString("base64url");
});

const voiceDeps = (): VoiceDeps => ({
  db: db(),
  now: () => new Date(),
  optOutKey: optOutKey(),
  maps: maps(),
  geocoder: geocoder(),
  storage: storage(),
  linkKey: linkKey(),
  secret: voiceSecret(),
  appBase: appUrl() || "bojen.se",
});

const VOICE_TOOL_RUNNERS: Record<
  VoiceToolName,
  (deps: VoiceDeps, call: CallRow, input: unknown) => Promise<unknown>
> = {
  hitta_kund: hittaKund,
  bekrafta_kund: bekraftaKund,
  foresla_tider: foreslaTider,
  skapa_bokning: skapaBokning,
  hamta_bokningar: (deps, call) => hamtaBokningar(deps, call),
  omboka_bokning: ombokaBokning,
  avboka_bokning: avbokaBokning,
  skicka_lank: skickaLank,
  satt_vantelista: sattVantelista,
  koppla_till_mekaniker: kopplaTillMekaniker,
  skapa_meddelande: skapaMeddelande,
  stoppa_inspelning: (deps, call) => stoppaInspelning(deps, call),
  avsluta_samtal: avslutaSamtal,
};

/** The receptionist's tools (step 6.1), for the voice agent of step 6.2. */
export const voiceToolsRoute = createVoiceToolsRoute({
  serviceSecret: () => {
    const secret = process.env.VOICE_SERVICE_SECRET;
    return secret && secret.length >= 32 ? secret : null;
  },
  tokenSecret: voiceSecret,
  now: () => new Date(),
  start: (input) => startCall(db(), { ...input, now: new Date() }),
  openCall: (tenantId, callId) => openCall(db(), tenantId, callId),
  context: (call) => callContext(voiceDeps(), call),
  run: (tool, call, input) => VOICE_TOOL_RUNNERS[tool](voiceDeps(), call, input),
});
