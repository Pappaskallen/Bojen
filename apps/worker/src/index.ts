import {
  createFakeEmail,
  createFakeSms,
  createMailgunEmail,
  elksFromEnv,
  systemClock,
} from "@bojen/adapters";
import type { EmailSender, SmsSender } from "@bojen/core";
import { connect, databaseUrl } from "@bojen/db";
import { run } from "graphile-worker";
import { bookingPageLink } from "./flows/deps";
import { taskList } from "./tasks";

/**
 * The background worker: Graphile Worker on the same Postgres. Fakes are only allowed
 * outside production, or with `BOJEN_FAKE_SERVICES=1` (the end-to-end tests).
 */
const production = process.env.NODE_ENV === "production" && process.env.BOJEN_FAKE_SERVICES !== "1";

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
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (apiKey && domain) {
    return createMailgunEmail({
      apiKey,
      domain,
      from: process.env.MAILGUN_FROM ?? `Bojen <noreply@${domain}>`,
    });
  }
  if (production) throw new Error("Mailgun is not configured (MAILGUN_API_KEY and MAILGUN_DOMAIN)");
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

async function main() {
  const url = databaseUrl();
  const { db } = connect(url);
  const runner = await run({
    connectionString: url,
    concurrency: 4,
    noHandleSignals: false,
    pollInterval: 2000,
    taskList: taskList({
      db,
      sms: smsSender(),
      email: emailSender(),
      now: () => systemClock.now(),
      optOutKey: optOutKey(),
      link: bookingPageLink(process.env.APP_URL ?? "bojen.se"),
    }),
  });
  console.info(`[worker] ${systemClock.now().toISOString()} started`);
  await runner.promise;
}

main().catch((error: unknown) => {
  console.error("[worker] stopped", error);
  process.exitCode = 1;
});
