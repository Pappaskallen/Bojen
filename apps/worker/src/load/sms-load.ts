/**
 * Load test for sms through the queue (byggplan, Avslutande kontroll: 500 sms per minute).
 *
 *   pnpm --filter @bojen/worker load:sms [antal=500] [fördröjning-ms=250]
 *
 * Against the local database (`pnpm db:start`): makes a firm of its own with one customer per
 * sms, queues every sms at once with `queueSms` as the flows do, and runs the worker as in
 * production (Graphile Worker, the same concurrency and poll interval, the real 46elks
 * adapter). 46elks is a local stand-in that answers after the given delay, like the real API
 * over the network, so nothing is sent. Passes when all are sent at 500 per minute or faster.
 * The firm and everything it got are removed afterwards. Not part of `pnpm test`: it takes a
 * minute and measures the machine as much as the code.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createElksSms, createFakeEmail } from "@bojen/adapters";
import { connect, customer, databaseUrl, message, queueSms, tenant } from "@bojen/db";
import { runMigrations } from "@bojen/db/migrate";
import { eq, sql } from "drizzle-orm";
import { run } from "graphile-worker";
import { WORKER_CONCURRENCY, WORKER_POLL_INTERVAL_MS, taskList } from "../tasks";
import { loadReport } from "./report";

const COUNT = Number(process.argv[2] ?? 500);
const LATENCY_MS = Number(process.argv[3] ?? 250);
const TARGET_PER_MINUTE = 500;
const TIMEOUT_MS = 5 * 60_000;
const KEY = "load-test-opt-out-key-not-secret";

/** A 46elks stand-in that answers after `latency` ms, as the real one does over the network. */
async function fakeElks(latency: number) {
  let requests = 0;
  let open = 0;
  let mostOpen = 0;
  const server = createServer((request, response) => {
    requests += 1;
    open += 1;
    mostOpen = Math.max(mostOpen, open);
    request.resume();
    request.on("end", () => {
      setTimeout(() => {
        open -= 1;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ id: `s${String(requests)}`, status: "created" }));
      }, latency);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    stats: () => ({ requests, mostOpen }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function main() {
  const url = databaseUrl();
  await runMigrations(url);
  const { db, close } = connect(url);
  const elks = await fakeElks(LATENCY_MS);
  const [firm] = await db
    .insert(tenant)
    .values({ name: `Belastningstest ${new Date().toISOString()}` })
    .returning();
  if (!firm) throw new Error("no firm");

  try {
    const customers = await db
      .insert(customer)
      .values(
        Array.from({ length: COUNT }, (_, i) => ({
          tenantId: firm.id,
          name: `Kund ${String(i + 1)}`,
          phone: `+4670${String(5_000_000 + i).padStart(7, "0")}`,
        })),
      )
      .returning({ id: customer.id, phone: customer.phone });

    // Queued at once, as a campaign does; one transaction per sms, ten at a time.
    // queueSms is given a past daytime moment, so quiet hours hold none back whenever the
    // test runs; when each was really queued is kept here.
    const daytime = new Date("2026-11-12T10:00:00+01:00");
    const queuedAt = new Map<string, Date>();
    const queueStart = Date.now();
    for (let i = 0; i < customers.length; i += 10) {
      await Promise.all(
        customers.slice(i, i + 10).map(async (c) => {
          const queued = await queueSms(
            { db, now: () => daytime, optOutKey: KEY },
            { tenantId: firm.id, to: c.phone, customerId: c.id },
            "f6_on_way",
            {
              mechanicFirstName: "Jonas",
              placeShort: "Bullandö",
              eta: "10:15",
              firm: "Testfirman",
            },
          );
          queuedAt.set(queued.messageId, new Date());
        }),
      );
    }
    console.info(`Köade ${String(COUNT)} sms på ${String(Date.now() - queueStart)} ms.`);

    const runner = await run({
      connectionString: url,
      concurrency: WORKER_CONCURRENCY,
      pollInterval: WORKER_POLL_INTERVAL_MS,
      noHandleSignals: true,
      taskList: taskList({
        db,
        sms: createElksSms({
          username: "load",
          password: "load",
          from: "Bojen",
          baseUrl: elks.url,
        }),
        email: createFakeEmail(),
        now: () => new Date(),
        optOutKey: KEY,
        link: () => "bojen.app/boka/test",
      }),
    });

    const deadline = Date.now() + TIMEOUT_MS;
    for (;;) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(message)
        .where(sql`${message.tenantId} = ${firm.id} and ${message.status} <> 'queued'`);
      if ((row?.n ?? 0) >= COUNT || Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await runner.stop();

    const rows = await db
      .select({ id: message.id, sentAt: message.sentAt, status: message.status })
      .from(message)
      .where(eq(message.tenantId, firm.id));
    const report = loadReport(
      rows.map((r) => ({
        queuedAt: queuedAt.get(r.id) ?? new Date(queueStart),
        sentAt: r.status === "sent" ? r.sentAt : null,
      })),
      { perMinute: TARGET_PER_MINUTE },
    );
    const { requests, mostOpen } = elks.stats();
    console.info(
      [
        `Skickade ${String(report.sent)} av ${String(report.total)} på ${String(report.seconds)} s: ${String(report.perMinute)} sms per minut (krav ${String(TARGET_PER_MINUTE)}).`,
        `Väntan i kön: median ${String(report.waitP50)} s, 95 % inom ${String(report.waitP95)} s, längst ${String(report.waitMax)} s.`,
        `46elks: ${String(requests)} anrop, högst ${String(mostOpen)} samtidigt, ${String(LATENCY_MS)} ms per svar.`,
        report.passed ? "Godkänt." : "Inte godkänt.",
      ].join("\n"),
    );
    if (!report.passed) process.exitCode = 1;
  } finally {
    await db.delete(message).where(eq(message.tenantId, firm.id));
    await db.delete(customer).where(eq(customer.tenantId, firm.id));
    await db.delete(tenant).where(eq(tenant.id, firm.id));
    await elks.close();
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
