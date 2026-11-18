import { createElksSms, createFakeClassifier, createFakeEmail } from "@bojen/adapters";
import { earliestSend } from "@bojen/core/messaging";
import { receiveSms, type Database } from "@bojen/db";
import { customerLinks } from "@bojen/worker/links";
import { taskList } from "@bojen/worker/tasks";
import { sql } from "drizzle-orm";
import type { JobHelpers } from "graphile-worker";
import { FAKE_ELKS_PASSWORD, FAKE_ELKS_URL, FAKE_ELKS_USER } from "./fake-elks";
import { E2E_SHORT_LINK_KEY } from "./keys";

type Job = Record<string, unknown> & {
  id: string;
  identifier: string;
  payload: unknown;
  run_at: Date;
};

/**
 * The worker's own tasks for one visit, in the test process (the chain test before the pilot).
 * Only this visit's jobs run: the whole worker would also send the demo data's sms, which
 * other tests count. The report draft is left to the global setup's worker.
 *
 * The web server's clock cannot be moved, so the worker's is: a job runs at its own time.
 * The sms go through the real 46elks adapter to the fake 46elks, as the web app's do. The
 * customer's answers come in through `receiveSms`, which the 46elks webhook calls, at the
 * worker's time: the web server would find a question sent "later" than its own clock not yet
 * open. (The webhook itself, its token and its form, has its own tests in test/elks-sms.)
 */
export function chainWorker(db: Database, visitId: string, appBase: string) {
  let clock = new Date();
  const now = () => clock;
  // The web app's development key: the STOPP list is the same for both.
  const optOutKey = "development-only-opt-out-key-not-secret";
  const tasks = taskList({
    db,
    now,
    optOutKey,
    link: customerLinks(db, E2E_SHORT_LINK_KEY, appBase, now),
    sms: createElksSms({
      username: FAKE_ELKS_USER,
      password: FAKE_ELKS_PASSWORD,
      from: "Bojen",
      baseUrl: FAKE_ELKS_URL,
    }),
    email: createFakeEmail(),
  });
  const helpers = { logger: { info: () => undefined } } as unknown as JobHelpers;

  const jobs = async (until: Date | null, identifier?: string) => [
    ...(await db.execute<Job>(sql`
      select j.id, t.identifier, j.payload, j.run_at
      from graphile_worker._private_jobs j
      join graphile_worker._private_tasks t on t.id = j.task_id
      where j.locked_at is null
        and t.identifier <> 'report_draft'
        and (${until === null} or j.run_at <= ${(until ?? clock).toISOString()}::timestamptz)
        and (${identifier ?? null}::text is null or t.identifier = ${identifier ?? null})
        and (
          j.payload->>'visitId' = ${visitId}
          or (t.identifier = 'domain_event' and exists (
            select 1 from domain_event e
            where e.id::text = j.payload->>'eventId'
              and (e.aggregate_id = ${visitId}::uuid or e.payload->>'visitId' = ${visitId})))
          or (t.identifier = 'send_message' and exists (
            select 1 from message m
            where m.id::text = j.payload->>'messageId' and m.visit_id = ${visitId}::uuid))
        )
      order by j.run_at, j.id`)),
  ];

  /** Runs this visit's jobs due by `until` (default: the worker's time), until none are left. */
  async function run(until?: Date): Promise<string[]> {
    if (clock.getTime() < Date.now()) clock = new Date();
    const ran: string[] = [];
    for (let round = 0; round < 20; round++) {
      // Again each round: a job one of the tasks just added has the database's time, which can
      // be a moment after the limit was first worked out (and the database's clock may run a
      // little ahead of this process's). Two seconds are far less than any planned job's delay.
      // At night (CI often runs after 21:00 in Stockholm) an sms is held until the morning:
      // the night passes for the worker, as it would for the real one. An hour more for a firm
      // whose quiet hours end later than 08:00.
      const morning = earliestSend(clock, "notice").getTime();
      const limit = new Date(
        Math.max(
          until?.getTime() ?? 0,
          clock.getTime(),
          Date.now() + 2_000,
          morning > clock.getTime() ? morning + 3_600_000 : 0,
        ),
      );
      const due = await jobs(limit);
      if (due.length === 0) return ran;
      for (const job of due) {
        await db.execute(sql`delete from graphile_worker._private_jobs where id = ${job.id}`);
        const at = new Date(job.run_at).getTime();
        clock = new Date(Math.max(clock.getTime(), at));
        const task = tasks[job.identifier];
        if (!task) throw new Error(`No task ${job.identifier}`);
        await task(job.payload, helpers);
        ran.push(job.identifier);
      }
    }
    throw new Error("The jobs never settled");
  }

  /** When this visit's next job of a kind is due, or null if none is waiting. */
  async function next(identifier: string): Promise<Date | null> {
    const [job] = await jobs(null, identifier);
    return job ? new Date(job.run_at) : null;
  }

  /** Throws away this visit's jobs that never came due, when the test is done. */
  async function clear() {
    for (const job of await jobs(null)) {
      await db.execute(sql`delete from graphile_worker._private_jobs where id = ${job.id}`);
    }
  }

  /** The customer's sms to the firm's number, a minute after the worker's last job. */
  async function answer(sms: { from: string; to: string; body: string; id: string }) {
    clock = new Date(clock.getTime() + 60_000);
    return receiveSms(
      { db, now, optOutKey, classifier: createFakeClassifier() },
      { externalId: sms.id, from: sms.from, to: sms.to, body: sms.body },
    );
  }

  /** The day of the visit has come: the worker's clock is the real one again. */
  function backToNow() {
    clock = new Date();
  }

  return { run, next, answer, backToNow, clear };
}
