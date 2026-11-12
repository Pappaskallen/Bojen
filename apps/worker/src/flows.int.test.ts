import { createFakeClassifier, createFakeEmail, createFakeSms } from "@bojen/adapters";
import {
  appUser,
  boat,
  boatPlacement,
  changeBooking,
  connect,
  createBooking,
  customer,
  databaseUrl,
  domainEvent,
  engine,
  job,
  location,
  managePage,
  message,
  receiveSms,
  rescheduleByLink,
  serviceType,
  survey,
  task,
  tenant,
  visit,
  workSchedule,
  type Database,
} from "@bojen/db";
import { runMigrations } from "@bojen/db/migrate";
import { and, eq, sql } from "drizzle-orm";
import type { JobHelpers, TaskList } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customerLinks } from "./flows/deps";
import { taskList } from "./tasks";

/**
 * Flows F1, F5, F7 and F9 end to end against the local database (byggplan step 3.3), with a
 * fake clock. The booking functions, the database trigger, Graphile Worker's job table and
 * the worker's own tasks are real; only the clock and the senders are fakes.
 *
 * `runDue` plays Graphile Worker's scheduler at the fake time: it runs the jobs this test's
 * transaction created (their `created_at` is the transaction's `now()`) whose `run_at` has come, in order, until none are left. Everything happens in one
 * transaction that is rolled back.
 */
const url = databaseUrl();
const connection = connect(url);
afterAll(() => connection.close());
beforeAll(() => runMigrations(url), 60_000);

class Rollback extends Error {}

const at = (stockholm: string) => new Date(`${stockholm}+01:00`); // November: UTC+1
const PHONE = "+46701119977";
const EMAIL = "per@kund.test";
const FIRM_NUMBER = "+46766860003";

type Job = Record<string, unknown> & {
  id: string;
  identifier: string;
  payload: unknown;
  run_at: Date;
};

async function setup(db: Database) {
  const [t] = await db
    .insert(tenant)
    .values({
      name: "Flödesfirman",
      slug: "flodesfirman",
      phone: "+46846500401",
      settings: { sms: { from: FIRM_NUMBER } },
    })
    .returning();
  const tenantId = t!.id;
  const [jonas] = await db
    .insert(appUser)
    .values({ tenantId, name: "Jonas Ek", role: "mechanic" })
    .returning();
  await db.insert(workSchedule).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      tenantId,
      userId: jonas!.id,
      weekday,
      startTime: "07:00",
      endTime: "17:00",
    })),
  );
  const [per] = await db
    .insert(customer)
    .values({ tenantId, name: "Per Persson", phone: PHONE, email: EMAIL })
    .returning();
  const [bustern] = await db
    .insert(boat)
    .values({ tenantId, name: "Bustern", make: "Nimbus", model: "3000" })
    .returning();
  await db
    .insert(engine)
    .values({ tenantId, boatId: bustern!.id, make: "Volvo Penta", model: "D3-220" });
  const [marina] = await db
    .insert(location)
    .values({
      tenantId,
      type: "marina",
      name: "Bullandö",
      position: { lng: 18.69, lat: 59.29 },
    })
    .returning();
  await db.insert(boatPlacement).values({
    tenantId,
    boatId: bustern!.id,
    locationId: marina!.id,
    season: "winter",
    mode: "land",
    spotId: "B14",
    haulOutDate: "2026-10-15",
    launchDate: "2027-05-01",
  });
  const [layUp] = await db
    .insert(serviceType)
    .values({ tenantId, name: "Vinterkonservering", defaultDurationMinutes: 120 })
    .returning();
  return {
    tenantId,
    mechanicId: jonas!.id,
    customerId: per!.id,
    boatId: bustern!.id,
    serviceTypeId: layUp!.id,
  };
}

/**
 * Plays Graphile Worker's scheduler at the fake time: runs the jobs this test's transaction
 * created whose `run_at` has come, in order, until none are left.
 */
async function jobRunner(db: Database, tasks: TaskList, clock: () => Date) {
  const [{ since }] = [...(await db.execute<{ since: Date }>(sql`select now() as since`))] as [
    { since: Date },
  ];
  const helpers = { logger: { info: () => undefined } } as unknown as JobHelpers;

  async function runDue(): Promise<string[]> {
    const ran: string[] = [];
    for (let round = 0; round < 20; round++) {
      const due = [
        ...(await db.execute<Job>(sql`
          select j.id, t.identifier, j.payload, j.run_at
          from graphile_worker._private_jobs j
          join graphile_worker._private_tasks t on t.id = j.task_id
          where j.created_at = ${since} and j.run_at <= ${clock().toISOString()}::timestamptz
          order by j.run_at, j.id`)),
      ];
      if (due.length === 0) return ran;
      for (const job of due) {
        await db.execute(sql`delete from graphile_worker._private_jobs where id = ${job.id}`);
        const run = tasks[job.identifier];
        if (!run) throw new Error(`No task ${job.identifier}`);
        await run(job.payload, helpers);
        ran.push(job.identifier);
      }
    }
    throw new Error("The jobs never settled");
  }
  const pending = async (identifier: string) =>
    [
      ...(await db.execute<Job>(sql`
        select j.id, t.identifier, j.payload, j.run_at
        from graphile_worker._private_jobs j
        join graphile_worker._private_tasks t on t.id = j.task_id
        where j.created_at = ${since} and t.identifier = ${identifier}`)),
    ].map((j) => new Date(j.run_at));
  return { runDue, pending };
}

async function inRollback(fn: (db: Database) => Promise<void>) {
  try {
    await connection.db.transaction(async (raw) => {
      await fn(raw as unknown as Database);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

describe("short links in F1 (step 3.4)", () => {
  it("F1 carries a short link; a reschedule through it sends a new F1 with a new link", async () => {
    await inRollback(async (db) => {
      let clock = at("2026-11-16T14:00:00");
      const sms = createFakeSms();
      const linkKey = "flow-test-short-link-key-0123456789abcdef";
      const deps = {
        db,
        sms,
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "flow-test-opt-out-key",
        link: customerLinks(db, linkKey, "https://bojen.se"),
      };
      const { runDue, pending } = await jobRunner(db, taskList(deps), () => clock);
      const f = await setup(db);
      const booked = await createBooking(
        { db, now: () => clock },
        {
          tenantId: f.tenantId,
          actor: { type: "staff", id: f.mechanicId },
          idempotencyKey: "link-book",
        },
        {
          customerId: f.customerId,
          boatId: f.boatId,
          serviceTypeId: f.serviceTypeId,
          mechanicId: f.mechanicId,
          start: at("2026-11-19T08:00:00"),
          channel: "phone",
          needsApproval: false,
          partsMissing: false,
        },
      );
      await runDue();
      const codeIn = (body: string | undefined) =>
        /bojen\.se\/x\/([A-Za-z0-9]{8}) /.exec(body ?? "")?.[1];
      const first = codeIn(sms.lastTo(PHONE));
      expect(first).toBeDefined();
      // The sms with an 8-character code still fits the template's segments.
      expect(sms.lastTo(PHONE)).toContain(`Ändra/avboka: bojen.se/x/${first!} /Flödesfirman`);
      const email = deps.email.sent[0]?.text ?? "";
      // One link per confirmation, in both the sms and the e-mail.
      expect(email).toContain(`Boka om eller avboka här: bojen.se/x/${first!}.`);

      // An hour later the customer moves it to Friday 08:00 through the link.
      clock = at("2026-11-16T15:00:00");
      await rescheduleByLink({ db, now: () => clock, linkKey }, first!, {
        start: at("2026-11-20T08:00:00"),
        mechanicId: f.mechanicId,
      });
      expect(await runDue()).toEqual(["domain_event", "send_message", "send_message"]);
      const second = codeIn(sms.lastTo(PHONE));
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(sms.lastTo(PHONE)).toContain("fre 20/11 kl 08-12");
      expect(await pending("visit_eta")).toEqual([at("2026-11-20T07:00:00")]);
      expect(await managePage({ db, now: () => clock, linkKey }, first!)).toMatchObject({
        state: "used",
      });
      expect(await managePage({ db, now: () => clock, linkKey }, second!)).toMatchObject({
        state: "valid",
      });

      // Running the same event again (a retried job) sends nothing more.
      const [event] = await db
        .select({ id: domainEvent.id })
        .from(domainEvent)
        .where(
          and(
            eq(domainEvent.aggregateId, booked.visit.id),
            eq(domainEvent.type, "visit.reschedule"),
          ),
        );
      await taskList(deps).domain_event!({ eventId: event!.id }, {
        logger: { info: () => undefined },
      } as unknown as JobHelpers);
      expect(await runDue()).toEqual([]);
      const confirmations = await db
        .select()
        .from(message)
        .where(and(eq(message.visitId, booked.visit.id), eq(message.template, "f1_confirmation")));
      expect(confirmations.map((m) => m.channel).sort()).toEqual(["email", "email", "sms", "sms"]);
    });
  }, 60_000);
});

describe("the availability check F3 (step 4.1)", () => {
  it("goes 24 h before, on Friday for a Monday, and not for late or emergency bookings", async () => {
    await inRollback(async (db) => {
      let clock = at("2026-11-16T14:00:00"); // Monday afternoon
      const sms = createFakeSms();
      const deps = {
        db,
        sms,
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "flow-test-opt-out-key",
        link: () => "bojen.se/x/Kp3d9AbC",
      };
      const { runDue, pending } = await jobRunner(db, taskList(deps), () => clock);
      const f = await setup(db);
      let n = 0;
      const book = async (start: Date, urgency: "planned" | "emergency" = "planned") => {
        const booked = await createBooking(
          { db, now: () => clock },
          {
            tenantId: f.tenantId,
            actor: { type: "staff", id: f.mechanicId },
            idempotencyKey: `check-${String(++n)}`,
          },
          {
            customerId: f.customerId,
            boatId: f.boatId,
            serviceTypeId: f.serviceTypeId,
            mechanicId: f.mechanicId,
            start,
            channel: "phone",
            needsApproval: false,
            partsMissing: false,
          },
        );
        if (urgency !== "planned") {
          await db.update(job).set({ urgency }).where(eq(job.id, booked.visit.jobId));
        }
        return booked.visit.id;
      };
      const statusOf = async (visitId: string) =>
        (
          await db.select({ s: visit.availabilityStatus }).from(visit).where(eq(visit.id, visitId))
        )[0]?.s;

      const wednesday = await book(at("2026-11-18T10:00:00"));
      const monday = await book(at("2026-11-23T10:00:00"));
      const late = await book(at("2026-11-17T13:00:00")); // 23 hours ahead
      const emergency = await book(at("2026-11-19T10:00:00"), "emergency");
      await runDue();

      // Late and emergency bookings get no check and count as confirmed.
      expect(await pending("visit_check")).toEqual([
        at("2026-11-17T10:00:00"),
        at("2026-11-20T12:00:00"),
      ]);
      expect(await statusOf(late)).toBe("skipped");
      expect(await statusOf(emergency)).toBe("skipped");
      expect(await statusOf(wednesday)).toBe("not_sent");

      // Tuesday 10:00, not a minute before.
      clock = at("2026-11-17T09:59:00");
      expect((await runDue()).filter((t) => t === "visit_check")).toEqual([]);
      clock = at("2026-11-17T10:00:00");
      expect(await runDue()).toEqual(["visit_check", "send_message"]);
      expect(sms.lastTo(PHONE)).toBe(
        "Hej Per! I morgon kl 08-12 kommer vi till Bustern. Står den på land på Bullandö, med nyckeln där du har angett? Svara JA, NEJ eller ÄNDRA. /Flödesfirman",
      );
      expect(await statusOf(wednesday)).toBe("pending");

      // The Monday visit is asked about on Friday at 12, as "På måndag".
      clock = at("2026-11-20T12:00:00");
      expect((await runDue()).filter((t) => t !== "visit_eta")).toEqual([
        "visit_check",
        "send_message",
      ]);
      expect(sms.lastTo(PHONE)).toContain("Hej Per! På måndag kl 08-12 kommer vi till Bustern.");
      expect(await statusOf(monday)).toBe("pending");
    });
  }, 60_000);

  it("moves with a reschedule, and an old job sends nothing", async () => {
    await inRollback(async (db) => {
      let clock = at("2026-11-16T14:00:00");
      const sms = createFakeSms();
      const deps = {
        db,
        sms,
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "flow-test-opt-out-key",
        link: () => "bojen.se/x/Kp3d9AbC",
      };
      const tasks = taskList(deps);
      const { runDue, pending } = await jobRunner(db, tasks, () => clock);
      const f = await setup(db);
      const staff = { tenantId: f.tenantId, actor: { type: "staff" as const, id: f.mechanicId } };
      const booked = await createBooking(
        { db, now: () => clock },
        { ...staff, idempotencyKey: "check-move-book" },
        {
          customerId: f.customerId,
          boatId: f.boatId,
          serviceTypeId: f.serviceTypeId,
          mechanicId: f.mechanicId,
          start: at("2026-11-18T10:00:00"),
          channel: "phone",
          needsApproval: false,
          partsMissing: false,
        },
      );
      await runDue();
      expect(await pending("visit_check")).toEqual([at("2026-11-17T10:00:00")]);

      clock = at("2026-11-16T15:00:00");
      await changeBooking(
        { db, now: () => clock },
        { ...staff, idempotencyKey: "check-move" },
        booked.visit.id,
        { event: "reschedule", start: at("2026-11-19T13:00:00") },
      );
      await runDue();
      expect(await pending("visit_check")).toEqual([at("2026-11-18T13:00:00")]);

      // A job left from the old time, run by hand on Tuesday, sends nothing.
      clock = at("2026-11-17T10:00:00");
      const sentBefore = sms.sent.length;
      await tasks.visit_check!({ tenantId: f.tenantId, visitId: booked.visit.id }, {
        logger: { info: () => undefined },
      } as unknown as JobHelpers);
      expect(await runDue()).toEqual([]);
      expect(sms.sent.length).toBe(sentBefore);

      clock = at("2026-11-18T13:00:00");
      expect(await runDue()).toEqual(["visit_check", "send_message"]);
      expect(sms.lastTo(PHONE)).toContain("I morgon kl 12-16 kommer vi till Bustern.");
    });
  }, 60_000);
});

describe("flows F1, F5, F7 and F9", () => {
  it("a booking is confirmed at once, F5 goes at 07:00, F9 18 h after done", async () => {
    try {
      await connection.db.transaction(async (raw) => {
        const db = raw as unknown as Database;
        let clock = at("2026-11-16T14:00:00"); // Monday afternoon
        const sms = createFakeSms();
        const email = createFakeEmail();
        const deps = {
          db,
          sms,
          email,
          now: () => clock,
          optOutKey: "flow-test-opt-out-key",
          link: () => "bojen.se/x/Kp3d9",
        };
        const { runDue, pending } = await jobRunner(db, taskList(deps), () => clock);
        const sentWith = async (template: string) =>
          db
            .select()
            .from(message)
            .where(
              and(
                eq(message.template, template),
                eq(message.toAddress, template.endsWith("email") ? EMAIL : PHONE),
              ),
            );

        const f = await setup(db);
        const staff = { tenantId: f.tenantId, actor: { type: "staff" as const, id: f.mechanicId } };

        // --- F1: Monday 14:00 the mechanic books Wednesday 08:00. ---
        const booked = await createBooking(
          { db, now: () => clock },
          { ...staff, idempotencyKey: "flow-book" },
          {
            customerId: f.customerId,
            boatId: f.boatId,
            serviceTypeId: f.serviceTypeId,
            mechanicId: f.mechanicId,
            start: at("2026-11-18T08:00:00"),
            channel: "phone",
            needsApproval: false,
            partsMissing: false,
          },
        );
        const visitId = booked.visit.id;
        expect(await runDue()).toEqual(["domain_event", "send_message", "send_message"]);
        expect(sms.lastTo(PHONE)).toBe(
          "Hej Per! Bokat: Vinterkonservering ons 18/11 kl 08-12, Bullandö. Du behöver inte vara på plats. Ändra/avboka: bojen.se/x/Kp3d9 /Flödesfirman",
        );
        expect(email.sent).toHaveLength(1);
        expect(email.sent[0]).toMatchObject({
          to: EMAIL,
          subject: "Bokningsbekräftelse: Vinterkonservering 18/11",
        });
        expect(email.sent[0]?.text).toContain("Nimbus 3000 – Volvo Penta D3-220");
        expect(email.sent[0]?.text).toContain("Bullandö, plats B14 (på land)");
        const [confirmation] = await db
          .select()
          .from(message)
          .where(
            and(
              eq(message.visitId, visitId),
              eq(message.template, "f1_confirmation"),
              eq(message.channel, "sms"),
            ),
          );
        expect(confirmation).toMatchObject({ status: "sent", sentAt: clock });

        // --- F3: the check goes 24 hours before, Tuesday 08:00 (step 4.1). ---
        expect(await pending("visit_check")).toEqual([at("2026-11-17T08:00:00")]);
        clock = at("2026-11-17T08:00:00");
        expect(await runDue()).toEqual(["visit_check", "send_message"]);
        expect(sms.lastTo(PHONE)).toContain("I morgon kl 08-12 kommer vi till Bustern.");

        // --- F5: put in for Wednesday 07:00, and nothing goes out before. ---
        expect(await pending("visit_eta")).toEqual([at("2026-11-18T07:00:00")]);
        clock = at("2026-11-18T06:59:00");
        expect(await runDue()).toEqual([]);
        clock = at("2026-11-18T07:00:00");
        expect(await runDue()).toEqual(["visit_eta", "send_message"]);
        expect(sms.lastTo(PHONE)).toBe(
          "God morgon! Jonas beräknas vara vid Bustern på Bullandö ca kl 07:00-09:00 i dag. /Flödesfirman",
        );
        const [eta] = await sentWith("f5_eta");
        expect(eta).toMatchObject({ visitId, status: "sent", sentAt: at("2026-11-18T07:00:00") });

        // --- F9: done at 16:45; the question goes 18 hours later, Thursday 10:45. ---
        clock = at("2026-11-18T08:05:00");
        await changeBooking(
          { db, now: () => clock },
          { ...staff, idempotencyKey: "flow-start" },
          visitId,
          { event: "start" },
        );
        clock = at("2026-11-18T16:45:00");
        await changeBooking(
          { db, now: () => clock },
          { ...staff, idempotencyKey: "flow-done" },
          visitId,
          { event: "complete" },
        );
        expect(await runDue()).toEqual(["domain_event", "domain_event"]);
        expect(await pending("visit_survey")).toEqual([at("2026-11-19T10:45:00")]);
        clock = at("2026-11-19T10:44:00");
        expect(await runDue()).toEqual([]);
        clock = at("2026-11-19T10:45:00");
        expect(await runDue()).toEqual(["visit_survey", "send_message"]);
        expect(sms.lastTo(PHONE)).toBe(
          "Hur nöjd är du med servicen i går? Svara med en siffra 1-5 (5 = mycket nöjd). /Flödesfirman",
        );
        const [question] = await sentWith("f9_survey");
        expect(question).toMatchObject({
          visitId,
          status: "sent",
          sentAt: at("2026-11-19T10:45:00"),
        });

        // The answer 2: stored, a task to call within 24 hours, and the mechanic's reply.
        clock = at("2026-11-19T11:05:00");
        await receiveSms(
          { db, now: () => clock, optOutKey: deps.optOutKey, classifier: createFakeClassifier() },
          { externalId: "elks-flow-1", from: PHONE, to: FIRM_NUMBER, body: "2" },
        );
        expect(await runDue()).toEqual(["domain_event", "send_message"]);
        const [stored] = await db.select().from(survey).where(eq(survey.visitId, visitId));
        expect(stored).toMatchObject({ score: 2, answeredAt: clock });
        const [call] = await db
          .select()
          .from(task)
          .where(and(eq(task.visitId, visitId), eq(task.type, "low_csat")));
        expect(call).toMatchObject({ priority: "high", title: "Ring Per Persson: betyg 2 av 5" });
        expect(sms.lastTo(PHONE)).toBe(
          "Tack för ärligt svar. Jag vill göra det bra igen - jag ringer dig senast i morgon. /Jonas",
        );

        // --- F7: the mechanic approves the report (the day view sends this from step 5.5). ---
        await db.insert(domainEvent).values({
          tenantId: f.tenantId,
          aggregateType: "visit",
          aggregateId: visitId,
          type: "report.approved",
          payload: {
            workDone: "Bytt motorolja och oljefilter.",
            hours: "412",
            nextService: "Våren 2027",
          },
          actorType: "staff",
          actorId: f.mechanicId,
        });
        expect(await runDue()).toEqual(["domain_event", "send_message", "send_message"]);
        expect(sms.lastTo(PHONE)).toBe(
          "Klart! Vinterkonservering på Bustern är utförd. Rapport, bilder och betalning: bojen.se/x/Kp3d9 Tack för förtroendet! /Flödesfirman",
        );
        expect(email.sent.at(-1)).toMatchObject({ subject: "Servicerapport: Bustern, 18/11" });
        expect(email.sent.at(-1)?.text).toContain("Bytt motorolja och oljefilter.");

        // Every message has the template it should, and F1 went out once.
        const templates = (
          await db
            .select({ t: message.template })
            .from(message)
            .where(eq(message.tenantId, f.tenantId))
        )
          .map((r) => r.t)
          .sort();
        expect(templates).toEqual(
          [
            "f1_confirmation",
            "f1_confirmation",
            "f3_check_land",
            "f5_eta",
            "f7_report",
            "f7_report",
            "f9_reply_poor",
            "f9_survey",
            null, // the customer's answer "2"
          ].sort(),
        );
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }, 60_000);
});
