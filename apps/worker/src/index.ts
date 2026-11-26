import { safeError } from "@bojen/core/logging";
import {
  createElksRecordings,
  createFakePush,
  createFakeTranscriber,
  createFakeEmail,
  createFakeSms,
  createFakeMaps,
  smtpEmailFromEnv,
  createOsrmMaps,
  elksFromEnv,
  errorReporterFromEnv,
  fortnoxFromEnv,
  kmsFromEnv,
  systemClock,
  webPushFromEnv,
} from "@bojen/adapters";
import type { EmailSender, PushSender, SmsSender } from "@bojen/core";
import { connect, databaseUrl, KPI_CRONTAB, PRIVACY_CRONTAB } from "@bojen/db";
import { run } from "graphile-worker";
import { customerLinks } from "./flows/deps";
import { FORTNOX_CRONTAB } from "./flows/fortnox";
import { postCallDeps, reportDeps } from "./report-deps";
import {
  WORKER_CONCURRENCY,
  WORKER_POLL_INTERVAL_MS,
  taskList,
  withSafeErrors,
  type EscalationDeps,
} from "./tasks";

/**
 * The background worker: Graphile Worker on the same Postgres. Fakes are only allowed
 * outside production, or with `BOJEN_FAKE_SERVICES=1` (the end-to-end tests).
 */
const production = process.env.NODE_ENV === "production" && process.env.BOJEN_FAKE_SERVICES !== "1";

/** Errors to GlitchTip when `GLITCHTIP_DSN` is set (byggplan step 9); nothing is sent otherwise. */
const errors = errorReporterFromEnv("worker");
process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandled rejection", safeError(reason));
  void errors.report(reason, { tags: { kind: "unhandledRejection" } });
});

function smsSender(): SmsSender {
  const elks = elksFromEnv();
  if (elks) return elks;
  if (production) throw new Error("46elks is not configured (ELKS_API_USERNAME and password)");
  const fake = createFakeSms();
  return {
    async send(message) {
      const sent = await fake.send(message);
      console.info(`[dev-sms] to ${message.to}: ${message.body}`);
      return sent;
    },
  };
}

function emailSender(): EmailSender {
  const smtp = smtpEmailFromEnv();
  if (smtp) return smtp;
  if (production)
    throw new Error("The mail server is not configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD)");
  const fake = createFakeEmail();
  return {
    async send(message) {
      const sent = await fake.send(message);
      console.info(`[dev-email] to ${message.to}: ${message.subject}`);
      return sent;
    },
  };
}

function optOutKey(): string {
  const key = process.env.SMS_OPT_OUT_KEY;
  if (key && key.length >= 32) return key;
  if (production) throw new Error("SMS_OPT_OUT_KEY must be at least 32 characters");
  return "development-only-opt-out-key-not-secret";
}

/** `SHORT_LINK_KEY`: the short links' codes are stored hashed with it; web uses the same. */
function linkKey(): string {
  const key = process.env.SHORT_LINK_KEY;
  if (key && key.length >= 32) return key;
  if (production) throw new Error("SHORT_LINK_KEY must be at least 32 characters");
  return "development-only-short-link-key-not-secret";
}

function pushSender(): PushSender {
  const push = webPushFromEnv();
  if (push) return push;
  if (production) throw new Error("Web push is not configured (VAPID keys and VAPID_SUBJECT)");
  const fake = createFakePush();
  return {
    async send(target, payload) {
      const sent = await fake.send(target, payload);
      console.info(`[dev-push] ${payload.title}`);
      return sent;
    },
  };
}

/** Alerts, follow-ups and voicemail (step 6.4). Speech to text waits for Azure (step 6.2b). */
function escalationDeps(): EscalationDeps {
  const username = process.env.ELKS_API_USERNAME;
  const password = process.env.ELKS_API_PASSWORD;
  return {
    push: pushSender(),
    recordings:
      username && password
        ? createElksRecordings({ username, password })
        : { fetch: () => Promise.resolve({ bytes: new Uint8Array(), contentType: "audio/wav" }) },
    transcriber: production ? null : createFakeTranscriber("Hej, ring upp mig om båten."),
    appBase: process.env.APP_URL ?? "https://bojen.app",
  };
}

async function main() {
  const url = databaseUrl();
  const { db } = connect(url);
  const reports = reportDeps(production);
  // Fortnox (step 8) once the app is registered (FORTNOX_CLIENT_ID and _SECRET).
  const fortnox = fortnoxFromEnv();
  const runner = await run({
    connectionString: url,
    concurrency: WORKER_CONCURRENCY,
    noHandleSignals: false,
    pollInterval: WORKER_POLL_INTERVAL_MS,
    crontab: [KPI_CRONTAB, PRIVACY_CRONTAB, ...(fortnox ? [FORTNOX_CRONTAB] : [])].join("\n"),
    taskList: withSafeErrors(
      taskList({
        db,
        sms: smsSender(),
        email: emailSender(),
        now: () => systemClock.now(),
        optOutKey: optOutKey(),
        link: customerLinks(db, linkKey(), process.env.APP_URL ?? "bojen.app"),
        reports,
        postCall: postCallDeps(production, reports.storage),
        escalation: escalationDeps(),
        privacy: { storage: reports.storage },
        ...(fortnox ? { fortnox: { api: fortnox, kms: kmsFromEnv(process.env, production) } } : {}),
        maps: process.env.OSRM_URL
          ? createOsrmMaps({ baseUrl: process.env.OSRM_URL })
          : createFakeMaps(),
      }),
      errors,
    ),
  });
  console.info(`[worker] ${systemClock.now().toISOString()} started`);
  await runner.promise;
}

main().catch(async (error: unknown) => {
  console.error("[worker] stopped", safeError(error));
  process.exitCode = 1;
  await errors.report(error, { level: "fatal", tags: { kind: "startup" } });
});
