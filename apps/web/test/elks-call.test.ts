/**
 * Byggplan step 6.4, "Klart när": a test where the agent process is shut off shows that the
 * call goes to the mechanic's number (rule K10). The agent here is the voice app's own health
 * check, run as a separate process and killed halfway.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAgentHealth, createFakeClassifier, createFakeSms } from "@bojen/adapters";
import { appUser, call, connect, tenant, type Database } from "@bojen/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createWebhookRoutes } from "../lib/webhooks";

const connection = connect();
afterAll(() => connection.close());

class Rollback extends Error {}

async function withRollback(fn: (db: Database) => Promise<void>) {
  try {
    await connection.db.transaction(async (tx) => {
      await fn(tx as unknown as Database);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const FIRM_NUMBER = "+46766860031";
const MECHANIC = "+46701119901";
const TOKEN = "elks-call-test-token-long-enough-12345";
const SIP = "sip:bojen@sip.example";
const VOICE = resolve(__dirname, "../../voice");

/** Starts the agent's health check as its own process; resolves with its address. */
function startAgent(): Promise<{ child: ChildProcess; url: string }> {
  const tsx = createRequire(resolve(VOICE, "package.json")).resolve("tsx");
  const child = spawn(
    process.execPath,
    ["--import", pathToFileURL(tsx).href, "src/health-cli.ts"],
    {
      cwd: VOICE,
      env: { ...process.env, VOICE_HEALTH_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("The agent did not start")), 15_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      const port = /health on (\d+)/.exec(chunk.toString())?.[1];
      if (!port) return;
      clearTimeout(timer);
      done({ child, url: `http://127.0.0.1:${port}/health` });
    });
    child.once("exit", (code) => fail(new Error(`The agent stopped: ${String(code)}`)));
  });
}

function routes(db: Database, health: () => Promise<boolean>) {
  return createWebhookRoutes({
    db: () => db,
    sms: () => createFakeSms(),
    now: () => new Date("2027-04-01T08:00:00Z"),
    smsHookSecret: () => undefined,
    elksToken: () => TOKEN,
    elksIps: () => null,
    classifier: () => createFakeClassifier(),
    optOutKey: () => "test-opt-out-key",
    voiceAgent: { sip: () => SIP, up: health },
    appUrl: () => "https://app.bojen.test",
  });
}

/** What 46elks posts to `voice_start` for a call to the firm's number. */
const ringing = (token = TOKEN) =>
  new Request(`https://app.bojen.test/api/webhooks/elks/samtal?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      direction: "incoming",
      callid: `c${crypto.randomUUID()}`,
      from: "+46709998877",
      to: FIRM_NUMBER,
      created: "2027-04-01 08:00:00.000000",
    }).toString(),
  });

async function firm(db: Database) {
  const [t] = await db
    .insert(tenant)
    .values({ name: "Reservfirman", settings: { sms: { from: FIRM_NUMBER } } })
    .returning();
  await db
    .insert(appUser)
    .values({ tenantId: t!.id, name: "Jonas", role: "owner", mobile: MECHANIC });
  return t!.id;
}

const voicemail = {
  play: "sound/beep",
  next: {
    record: `https://app.bojen.test/api/webhooks/elks/rostbrevlada?token=${TOKEN}`,
    timelimit: "120",
  },
};

describe("a call to the firm's number (K10)", () => {
  it("goes to the agent while it runs, and to the mechanic's mobile once the process is shut off", async () => {
    const agent = await startAgent();
    try {
      await withRollback(async (db) => {
        await firm(db);
        const hooks = routes(db, createAgentHealth({ url: agent.url, timeoutMs: 1500 }));

        const up = await hooks.elksCall(ringing());
        expect(up.status).toBe(200);
        // The agent first; if it fails during the call, 46elks rings the mechanic itself.
        expect(await up.json()).toEqual({
          connect: SIP,
          timeout: "10",
          failed: { connect: MECHANIC, timeout: "25", failed: voicemail, busy: voicemail },
          busy: { connect: MECHANIC, timeout: "25", failed: voicemail, busy: voicemail },
        });

        // The agent process is shut off.
        await new Promise<void>((done) => {
          agent.child.once("exit", () => done());
          agent.child.kill();
        });
        const down = await hooks.elksCall(ringing());
        expect(await down.json()).toEqual({
          connect: MECHANIC,
          timeout: "25",
          failed: voicemail,
          busy: voicemail,
        });
      });
    } finally {
      if (agent.child.exitCode === null) agent.child.kill();
    }
  }, 30_000);

  it("needs the token, and turns away numbers that are no firm's", async () => {
    await withRollback(async (db) => {
      const hooks = routes(db, () => Promise.resolve(false));
      expect((await hooks.elksCall(ringing("wrong"))).status).toBe(401);
      expect(await (await hooks.elksCall(ringing())).json()).toEqual({ hangup: "reject" });
    });
  });

  it("keeps the voicemail for the worker to transcribe", async () => {
    await withRollback(async (db) => {
      const tenantId = await firm(db);
      const hooks = routes(db, () => Promise.resolve(false));
      const response = await hooks.elksVoicemail(
        new Request(`https://app.bojen.test/api/webhooks/elks/rostbrevlada?token=${TOKEN}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            callid: "elks-1",
            from: "+46709998877",
            to: FIRM_NUMBER,
            wav: "https://api.46elks.com/a1/recordings/r1.wav",
            duration: "12",
            created: "2027-04-01 08:00:00",
          }).toString(),
        }),
      );
      expect(response.status).toBe(204);
      const [saved] = await db
        .select()
        .from(call)
        .where(and(eq(call.tenantId, tenantId)));
      expect(saved).toMatchObject({
        callerNumber: "+46709998877",
        outcome: "message",
        recordingAllowed: false,
      });
      const jobs = await db.execute<{ key: string }>(
        sql`select key from graphile_worker._private_jobs where key = ${`voicemail:${saved!.id}`}`,
      );
      expect([...jobs]).toHaveLength(1);
    });
  });
});
