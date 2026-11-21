// The server's own secrets for infra/.env (byggplan step 9), printed once:
//   node infra/scripts/make-secrets.mjs >> infra/.env
// Supabase's anon and service keys are JWTs signed with JWT_SECRET, as in its self-hosting.
// Keep a copy of infra/.env somewhere safe: SMS_OPT_OUT_KEY and SHORT_LINK_KEY can never be
// changed, and without BACKUP_ENCRYPTION_KEY the backups cannot be read.
import { createHmac, randomBytes } from "node:crypto";

const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwtSecret = random(48);
const jwt = (role) => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    role,
    iss: "supabase",
    iat: now,
    exp: now + 10 * 365 * 24 * 3600,
  })}`;
  return `${body}.${createHmac("sha256", jwtSecret).update(body).digest("base64url")}`;
};

const lines = {
  POSTGRES_PASSWORD: random(),
  JWT_SECRET: jwtSecret,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
  SUPABASE_AUTH_SMS_HOOK_SECRET: `v1,whsec_${randomBytes(32).toString("base64")}`,
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  GLITCHTIP_DB_PASSWORD: random(),
  GLITCHTIP_SECRET_KEY: randomBytes(32).toString("hex"),
  LIVEKIT_API_KEY: `API${randomBytes(6).toString("hex")}`,
  LIVEKIT_API_SECRET: random(),
  SHORT_LINK_KEY: random(),
  SMS_OPT_OUT_KEY: random(),
  BOOKING_SESSION_SECRET: random(),
  ELKS_WEBHOOK_SECRET: random(),
  VOICE_TOOLS_SECRET: random(),
  VOICE_SERVICE_SECRET: random(),
};
for (const [name, value] of Object.entries(lines)) console.log(`${name}=${value}`);
