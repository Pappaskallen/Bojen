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
  waitlistEntry,
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
    locationId: marina!.id,
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
        where j.created_at = ${since} and t.identifier = ${identifier}
        order by j.run_at`)),
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
      expect((await runDue()).filter((t) => t === "visit_check" || t === "send_message")).toEqual([
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

describe("answers to the availability check (step 4.2)", () => {
  /** A visit Wednesday 10:00, booked Monday, whose check has just gone out Tuesday 10:00. */
  async function checked(
    fn: (c: {
      db: Database;
      f: Awaited<ReturnType<typeof setup>>;
      visitId: string;
      sms: ReturnType<typeof createFakeSms>;
      runDue: () => Promise<string[]>;
      pending: (identifier: string) => Promise<Date[]>;
      setClock: (to: Date) => void;
      reply: (body: string, classifier?: ReturnType<typeof createFakeClassifier>) => Promise<void>;
      state: () => Promise<{ status: string; availability: string }>;
      tasks: (
        type: "call_back" | "change_request" | "unclear_reply",
      ) => Promise<{ title: string; priority: string; status: string; note: string | null }[]>;
    }) => Promise<void>,
  ) {
    await inRollback(async (db) => {
      let clock = at("2026-11-16T14:00:00");
      const sms = createFakeSms();
      const deps = {
        db,
        sms,
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "flow-test-opt-out-key",
        link: customerLinks(db, "flow-test-short-link-key-0123456789abcdef", "https://bojen.se"),
      };
      const { runDue, pending } = await jobRunner(db, taskList(deps), () => clock);
      const f = await setup(db);
      const booked = await createBooking(
        { db, now: () => clock },
        {
          tenantId: f.tenantId,
          actor: { type: "staff", id: f.mechanicId },
          idempotencyKey: "answer-book",
        },
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
      const visitId = booked.visit.id;
      await runDue();
      clock = at("2026-11-17T10:00:00");
      expect(await runDue()).toEqual(["visit_check", "send_message"]);
      expect(await pending("visit_check_reminder")).toEqual([at("2026-11-17T14:00:00")]);
      expect(await pending("visit_check_escalation")).toEqual([at("2026-11-17T18:00:00")]);

      let n = 0;
      await fn({
        db,
        f,
        visitId,
        sms,
        runDue,
        pending,
        setClock: (to) => {
          clock = to;
        },
        reply: async (body, classifier = createFakeClassifier()) => {
          await receiveSms(
            { db, now: () => clock, optOutKey: deps.optOutKey, classifier },
            { externalId: `elks-answer-${String(++n)}`, from: PHONE, to: FIRM_NUMBER, body },
          );
        },
        state: async () => {
          const [row] = await db
            .select({ status: visit.status, availability: visit.availabilityStatus })
            .from(visit)
            .where(eq(visit.id, visitId));
          return row!;
        },
        tasks: (type) =>
          db
            .select({
              title: task.title,
              priority: task.priority,
              status: task.status,
              note: task.note,
            })
            .from(task)
            .where(and(eq(task.visitId, visitId), eq(task.type, type))),
      });
    });
  }

  it("JA confirms the visit, and the reminder and the task never come", async () => {
    await checked(async (c) => {
      c.setClock(at("2026-11-17T10:30:00"));
      await c.reply("JA");
      expect((await c.runDue()).sort()).toEqual(["domain_event", "domain_event", "send_message"]);
      expect(await c.state()).toEqual({ status: "confirmed", availability: "confirmed" });
      expect(c.sms.lastTo(PHONE)).toBe(
        "Tack! Bokningen är bekräftad. Du får ungefärlig tid i morgon bitti.",
      );

      const sent = c.sms.sent.length;
      c.setClock(at("2026-11-17T18:00:00"));
      expect(await c.runDue()).toEqual(["visit_check_reminder", "visit_check_escalation"]);
      expect(c.sms.sent.length).toBe(sent);
      expect(await c.tasks("call_back")).toEqual([]);
      expect(await c.state()).toEqual({ status: "confirmed", availability: "confirmed" });
    });
  }, 60_000);

  it("NEJ cancels free of charge, sends the rebooking link and frees the time for F4", async () => {
    await checked(async (c) => {
      c.setClock(at("2026-11-17T10:30:00"));
      await c.reply("Nej");
      // The answer, the cancellation's own event, the receipt and F4's first round.
      expect((await c.runDue()).sort()).toEqual([
        "domain_event",
        "domain_event",
        "send_message",
        "waitlist_round",
      ]);
      expect(await c.state()).toEqual({ status: "cancelled", availability: "declined" });
      expect(c.sms.lastTo(PHONE)).toBe(
        "Okej, vi avbokar. Välj en ny tid här: bojen.se/boka/flodesfirman - eller svara NY så ringer vi dig. /Flödesfirman",
      );
      // The cancellation's own event is what the waitlist flow F4 starts from (step 4.3).
      const [cancelled] = await c.db
        .select()
        .from(domainEvent)
        .where(and(eq(domainEvent.aggregateId, c.visitId), eq(domainEvent.type, "visit.cancel")));
      expect(cancelled).toMatchObject({ actorType: "system" });
      expect(cancelled?.payload).toMatchObject({ to: "cancelled", reason: "availability_check" });

      const sent = c.sms.sent.length;
      c.setClock(at("2026-11-17T18:00:00"));
      await c.runDue();
      expect(c.sms.sent.length).toBe(sent);
      expect(await c.tasks("call_back")).toEqual([]);
    });
  }, 60_000);

  it("ÄNDRA makes a task with high priority and leaves the visit booked", async () => {
    await checked(async (c) => {
      c.setClock(at("2026-11-17T10:30:00"));
      await c.reply("ändra");
      expect(await c.runDue()).toEqual(["domain_event", "send_message"]);
      expect(await c.state()).toEqual({ status: "booked", availability: "change_requested" });
      expect(await c.tasks("change_request")).toEqual([
        {
          title: "Per Persson vill ändra något inför besöket",
          priority: "high",
          status: "open",
          note: null,
        },
      ]);
      expect(c.sms.lastTo(PHONE)).toBe(
        "Tack! Jonas hör av sig i dag. Skriv gärna här vad som ändrats.",
      );
    });
  }, 60_000);

  it("free text counts when it is read with certainty, and becomes a task when not", async () => {
    await checked(async (c) => {
      c.setClock(at("2026-11-17T10:30:00"));
      // Not understood: a task for a person with the text, and the check keeps waiting.
      await c.reply("Hur länge blir ni kvar?");
      expect(await c.runDue()).toEqual(["domain_event"]);
      expect(await c.state()).toEqual({ status: "booked", availability: "pending" });
      expect(await c.tasks("unclear_reply")).toMatchObject([{ note: "Hur länge blir ni kvar?" }]);
    });
    await checked(async (c) => {
      c.setClock(at("2026-11-17T10:30:00"));
      const classifier = createFakeClassifier();
      classifier.answer("Båten ligger där som vanligt", { intent: "yes", confidence: 0.97 });
      await c.reply("Båten ligger där som vanligt", classifier);
      await c.runDue();
      expect(await c.state()).toEqual({ status: "confirmed", availability: "confirmed" });
    });
  }, 60_000);

  it("a visit the firm cancels while the check waits gets no reminder and no task", async () => {
    await checked(async (c) => {
      c.setClock(at("2026-11-17T11:00:00"));
      await changeBooking(
        { db: c.db, now: () => at("2026-11-17T11:00:00") },
        {
          tenantId: c.f.tenantId,
          actor: { type: "staff", id: c.f.mechanicId },
          idempotencyKey: "answer-staff-cancel",
        },
        c.visitId,
        { event: "cancel" },
      );
      await c.runDue();
      const sent = c.sms.sent.length;
      c.setClock(at("2026-11-17T18:00:00"));
      expect(await c.runDue()).toEqual(["visit_check_reminder", "visit_check_escalation"]);
      expect(c.sms.sent.length).toBe(sent);
      expect(await c.tasks("call_back")).toEqual([]);
      expect(await c.state()).toEqual({ status: "cancelled", availability: "pending" });
    });
  }, 60_000);

  it("no answer gives a reminder after 4 h, then a task at 18, and never a cancellation", async () => {
    await checked(async (c) => {
      c.setClock(at("2026-11-17T13:59:00"));
      expect(await c.runDue()).toEqual([]);
      c.setClock(at("2026-11-17T14:00:00"));
      expect(await c.runDue()).toEqual(["visit_check_reminder", "send_message"]);
      expect(c.sms.lastTo(PHONE)).toBe(
        "Påminnelse: vi kommer i morgon kl 08-12 till Bullandö. Är båten tillgänglig? Svara JA, NEJ eller ÄNDRA.",
      );
      expect(await c.state()).toEqual({ status: "booked", availability: "pending" });

      c.setClock(at("2026-11-17T17:59:00"));
      expect(await c.runDue()).toEqual([]);
      const sent = c.sms.sent.length;
      c.setClock(at("2026-11-17T18:00:00"));
      expect(await c.runDue()).toEqual(["visit_check_escalation", "domain_event"]);
      expect(await c.state()).toEqual({ status: "unconfirmed", availability: "no_reply" });
      expect(await c.tasks("call_back")).toEqual([
        {
          title: "Ring Per Persson: inget svar på kontrollen",
          priority: "high",
          status: "open",
          note: null,
        },
      ]);
      expect(c.sms.sent.length).toBe(sent);

      // An answer to the reminder later that evening still counts and closes the task.
      c.setClock(at("2026-11-17T19:30:00"));
      await c.reply("ja");
      await c.runDue();
      expect(await c.state()).toEqual({ status: "confirmed", availability: "confirmed" });
      expect(await c.tasks("call_back")).toMatchObject([{ status: "done" }]);
      // F5 still goes in the morning.
      expect(await c.pending("visit_eta")).toEqual([at("2026-11-18T07:00:00")]);
    });
  }, 60_000);
});

describe("the waitlist fills a cancelled time (F4, step 4.3)", () => {
  const FIRM_PHONE_OFFSET = 70_111_3000;
  const phoneOf = (n: number) => `+46${String(FIRM_PHONE_OFFSET + n)}`;

  /** A customer waiting for a time: their own boat on land, at `locationId`, and an entry. */
  async function waiter(
    db: Database,
    f: Awaited<ReturnType<typeof setup>>,
    n: number,
    over: { locationId?: string; createdAt?: Date } = {},
  ) {
    const [c] = await db
      .insert(customer)
      .values({ tenantId: f.tenantId, name: `Kund ${String(n)}`, phone: phoneOf(n) })
      .returning();
    const [b] = await db
      .insert(boat)
      .values({ tenantId: f.tenantId, name: `Båt ${String(n)}` })
      .returning();
    await db.insert(boatPlacement).values({
      tenantId: f.tenantId,
      boatId: b!.id,
      locationId: over.locationId ?? f.locationId,
      season: "winter",
      mode: "land",
      haulOutDate: "2026-10-15",
      launchDate: "2027-05-01",
    });
    await db.insert(waitlistEntry).values({
      tenantId: f.tenantId,
      customerId: c!.id,
      boatId: b!.id,
      serviceTypeId: f.serviceTypeId,
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    });
    return { customerId: c!.id, phone: phoneOf(n) };
  }

  /** Monday 14:00. Per's visit on Wednesday 10:00 is booked and then cancelled by Per. */
  async function cancelled(
    fn: (c: {
      db: Database;
      f: Awaited<ReturnType<typeof setup>>;
      visitId: string;
      sms: ReturnType<typeof createFakeSms>;
      runDue: () => Promise<string[]>;
      pending: (identifier: string) => Promise<Date[]>;
      setClock: (to: Date) => void;
      reply: (from: string, body: string) => Promise<void>;
      cancel: (visitId: string) => Promise<void>;
      told: (phone: string, template: string) => Promise<number>;
      holders: () => Promise<{ customerId: string; channel: string }[]>;
    }) => Promise<void>,
    start = at("2026-11-18T10:00:00"),
  ) {
    await inRollback(async (db) => {
      let clock = at("2026-11-16T14:00:00");
      const sms = createFakeSms();
      const deps = {
        db,
        sms,
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "flow-test-opt-out-key",
        link: () => "bojen.se/boka/flodesfirman",
      };
      const { runDue, pending } = await jobRunner(db, taskList(deps), () => clock);
      const f = await setup(db);
      const staff = { tenantId: f.tenantId, actor: { type: "staff" as const, id: f.mechanicId } };
      const booked = await createBooking(
        { db, now: () => clock },
        { ...staff, idempotencyKey: "waitlist-book" },
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
      const visitId = booked.visit.id;
      await runDue();
      let n = 0;
      await fn({
        db,
        f,
        visitId,
        sms,
        runDue,
        pending,
        setClock: (to) => {
          clock = to;
        },
        reply: async (from, body) => {
          await receiveSms(
            { db, now: () => clock, optOutKey: deps.optOutKey, classifier: createFakeClassifier() },
            { externalId: `elks-waitlist-${String(++n)}`, from, to: FIRM_NUMBER, body },
          );
        },
        cancel: async (id) => {
          await changeBooking(
            { db, now: () => clock },
            {
              tenantId: f.tenantId,
              // The firm cancels: 44 hours ahead is inside the customer's own 48-hour limit.
              actor: { type: "staff", id: f.mechanicId },
              idempotencyKey: `waitlist-cancel-${id}`,
            },
            id,
            { event: "cancel" },
          );
        },
        told: async (phone, template) =>
          (
            await db
              .select({ id: message.id })
              .from(message)
              .where(
                and(
                  eq(message.tenantId, f.tenantId),
                  eq(message.template, template),
                  eq(message.toAddress, phone),
                  eq(message.direction, "outbound"),
                ),
              )
          ).length,
        holders: async () =>
          (
            await db.execute<{ customer_id: string; channel: string }>(sql`
              select j.customer_id, j.channel from visit v
              join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
              where v.tenant_id = ${f.tenantId} and v.mechanic_id = ${f.mechanicId}
                and v.status <> 'cancelled'
                and v.time_window && ${`[${start.toISOString()},${new Date(start.getTime() + 7_200_000).toISOString()})`}::tstzrange`)
          ).map((r) => ({ customerId: r.customer_id, channel: r.channel })),
      });
    });
  }

  const OFFER = (boatName: string) =>
    `Ledig tid! ons 18/11 kl 08-12 på Bullandö - passar Vinterkonservering för ${boatName}? Svara JA inom 1 tim så är den din. /Flödesfirman`;

  it("three on the list all answer JA: exactly one gets the time and the others are told", async () => {
    await cancelled(async (c) => {
      const a = await waiter(c.db, c.f, 1, { createdAt: new Date("2026-10-01T10:00:00Z") });
      const b = await waiter(c.db, c.f, 2, { createdAt: new Date("2026-10-02T10:00:00Z") });
      const d = await waiter(c.db, c.f, 3, { createdAt: new Date("2026-10-03T10:00:00Z") });

      // Per cancels: the offer goes to all three at once, the one who waited longest first.
      await c.cancel(c.visitId);
      await c.runDue();
      expect(c.sms.lastTo(a.phone)).toBe(OFFER("Båt 1"));
      expect(c.sms.lastTo(b.phone)).toBe(OFFER("Båt 2"));
      expect(c.sms.lastTo(d.phone)).toBe(OFFER("Båt 3"));
      expect(await c.holders()).toEqual([]);

      // All three answer JA, a few minutes apart, before the worker has handled any.
      c.setClock(at("2026-11-16T14:10:00"));
      await c.reply(a.phone, "JA");
      await c.reply(b.phone, "ja");
      await c.reply(d.phone, "Japp");
      await c.runDue();

      // The first answer got the time, as a booking made by the customer, from the waitlist.
      expect(await c.holders()).toEqual([{ customerId: a.customerId, channel: "waitlist" }]);
      const entries = await c.db
        .select()
        .from(waitlistEntry)
        .where(eq(waitlistEntry.tenantId, c.f.tenantId));
      expect(entries.map((e) => [e.customerId, e.status]).sort()).toEqual(
        [
          [a.customerId, "booked"],
          [b.customerId, "waiting"],
          [d.customerId, "waiting"],
        ].sort(),
      );
      // The winner gets the usual confirmation, and the others are told once.
      expect(c.sms.lastTo(a.phone)).toContain("Bokat: Vinterkonservering ons 18/11 kl 08-12");
      expect(await c.told(a.phone, "f4_taken")).toBe(0);
      for (const other of [b, d]) {
        expect(await c.told(other.phone, "f4_taken")).toBe(1);
        expect(c.sms.lastTo(other.phone)).toBe(
          "Tiden blev tyvärr tagen. Du står kvar på väntelistan - vi hör av oss!",
        );
      }
    });
  }, 60_000);

  it("the others who have not answered are told at once, and a late JA is told as well", async () => {
    await cancelled(async (c) => {
      const a = await waiter(c.db, c.f, 1, { createdAt: new Date("2026-10-01T10:00:00Z") });
      const b = await waiter(c.db, c.f, 2, { createdAt: new Date("2026-10-02T10:00:00Z") });
      const d = await waiter(c.db, c.f, 3, { createdAt: new Date("2026-10-03T10:00:00Z") });
      await c.cancel(c.visitId);
      await c.runDue();

      c.setClock(at("2026-11-16T14:10:00"));
      await c.reply(d.phone, "JA");
      await c.runDue();
      expect(await c.holders()).toEqual([{ customerId: d.customerId, channel: "waitlist" }]);
      // Nobody else has answered: both are told that the time is gone.
      expect(await c.told(a.phone, "f4_taken")).toBe(1);
      expect(await c.told(b.phone, "f4_taken")).toBe(1);

      // One of them answers JA after all and gets an answer, and still no second booking.
      c.setClock(at("2026-11-16T14:20:00"));
      await c.reply(a.phone, "JA");
      await c.runDue();
      expect(await c.told(a.phone, "f4_taken")).toBe(2);
      expect((await c.holders()).length).toBe(1);
      expect(await c.told(d.phone, "f4_taken")).toBe(0);
    });
  }, 60_000);

  it("NEJ keeps the customer on the list and books nothing", async () => {
    await cancelled(async (c) => {
      const a = await waiter(c.db, c.f, 1, { createdAt: new Date("2026-10-01T10:00:00Z") });
      await c.cancel(c.visitId);
      await c.runDue();
      c.setClock(at("2026-11-16T14:05:00"));
      await c.reply(a.phone, "nej");
      await c.runDue();
      const [entry] = await c.db
        .select()
        .from(waitlistEntry)
        .where(eq(waitlistEntry.customerId, a.customerId));
      expect(entry?.status).toBe("waiting");
      expect(await c.holders()).toEqual([]);
      expect(await c.told(a.phone, "f4_taken")).toBe(0);
    });
  }, 60_000);

  it("offers to five at a time, an hour apart, in at most three rounds", async () => {
    await cancelled(async (c) => {
      const people: Awaited<ReturnType<typeof waiter>>[] = [];
      for (let i = 1; i <= 12; i++) {
        people.push(
          await waiter(c.db, c.f, i, {
            createdAt: new Date(`2026-10-${String(i).padStart(2, "0")}T10:00:00Z`),
          }),
        );
      }
      const offered = async () => {
        const out = [];
        for (const [i, p] of people.entries()) {
          if ((await c.told(p.phone, "f4_offer")) > 0) out.push(i + 1);
        }
        return out;
      };

      await c.cancel(c.visitId);
      await c.runDue();
      expect(await offered()).toEqual([1, 2, 3, 4, 5]);
      expect(await c.pending("waitlist_round")).toEqual([at("2026-11-16T15:00:00")]);

      c.setClock(at("2026-11-16T14:59:00"));
      await c.runDue();
      expect(await offered()).toEqual([1, 2, 3, 4, 5]);
      c.setClock(at("2026-11-16T15:00:00"));
      await c.runDue();
      expect(await offered()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(await c.pending("waitlist_round")).toEqual([at("2026-11-16T16:00:00")]);

      c.setClock(at("2026-11-16T16:00:00"));
      await c.runDue();
      expect(await offered()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      // Nobody is left to ask, and there is never a fourth round.
      expect(await c.pending("waitlist_round")).toEqual([]);
      c.setClock(at("2026-11-17T09:00:00"));
      await c.runDue();
      expect(await offered()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

      // A JA to the first round's offer, long after its hour, is not an answer to it.
      const before = c.sms.sent.length;
      await c.reply(people[0]!.phone, "JA");
      await c.runDue();
      expect(await c.holders()).toEqual([]);
      expect(c.sms.sent.length).toBe(before);
    });
  }, 60_000);

  it("asks only those the time suits, not a boat 50 km away", async () => {
    await cancelled(async (c) => {
      const [far] = await c.db
        .insert(location)
        .values({
          tenantId: c.f.tenantId,
          type: "marina",
          name: "Norrtälje",
          position: { lng: 18.7, lat: 59.76 },
        })
        .returning();
      const near = await waiter(c.db, c.f, 1, { createdAt: new Date("2026-10-05T10:00:00Z") });
      const away = await waiter(c.db, c.f, 2, {
        locationId: far!.id,
        createdAt: new Date("2026-10-01T10:00:00Z"),
      });
      const second = await waiter(c.db, c.f, 3, { createdAt: new Date("2026-10-06T10:00:00Z") });
      // The first round asks only the one who suits, not the one 50 km away.
      await c.cancel(c.visitId);
      await c.runDue();
      expect(await c.told(away.phone, "f4_offer")).toBe(0);
      expect([
        await c.told(near.phone, "f4_offer"),
        await c.told(second.phone, "f4_offer"),
      ]).toEqual([1, 1]);
    });
  }, 60_000);

  it("stops asking when someone else has been given the time", async () => {
    await cancelled(async (c) => {
      const people: Awaited<ReturnType<typeof waiter>>[] = [];
      for (let i = 1; i <= 8; i++) {
        people.push(
          await waiter(c.db, c.f, i, {
            createdAt: new Date(`2026-10-${String(i).padStart(2, "0")}T10:00:00Z`),
          }),
        );
      }
      await c.cancel(c.visitId);
      await c.runDue();
      expect(await c.told(people[4]!.phone, "f4_offer")).toBe(1);
      expect(await c.told(people[5]!.phone, "f4_offer")).toBe(0);

      // The mechanic books the time for someone who phoned, before the second round.
      c.setClock(at("2026-11-16T14:30:00"));
      await createBooking(
        { db: c.db, now: () => at("2026-11-16T14:30:00") },
        {
          tenantId: c.f.tenantId,
          actor: { type: "staff", id: c.f.mechanicId },
          idempotencyKey: "waitlist-phoned",
        },
        {
          customerId: c.f.customerId,
          boatId: c.f.boatId,
          serviceTypeId: c.f.serviceTypeId,
          mechanicId: c.f.mechanicId,
          start: at("2026-11-18T10:00:00"),
          channel: "phone",
          needsApproval: false,
          partsMissing: false,
        },
      );
      c.setClock(at("2026-11-16T15:00:00"));
      await c.runDue();
      for (const p of people.slice(5)) expect(await c.told(p.phone, "f4_offer")).toBe(0);

      // A JA to the first round is told that the time is gone, and nothing is booked twice.
      c.setClock(at("2026-11-16T14:40:00"));
      await c.reply(people[0]!.phone, "JA");
      await c.runDue();
      expect(await c.told(people[0]!.phone, "f4_taken")).toBeGreaterThan(0);
      expect((await c.holders()).map((h) => h.channel)).toEqual(["phone"]);
    });
  }, 60_000);

  it("does not start for a time less than two hours ahead", async () => {
    await cancelled(async (c) => {
      const a = await waiter(c.db, c.f, 1);
      c.setClock(at("2026-11-18T08:30:00"));
      await c.cancel(c.visitId);
      await c.runDue();
      expect(await c.told(a.phone, "f4_offer")).toBe(0);
    }, at("2026-11-18T10:00:00"));
  }, 60_000);
});

describe("the pipeline moves on its own (step 5.4)", () => {
  it("a job is done when its visit is, and invoiced when Fortnox says an invoice is made", async () => {
    await inRollback(async (db) => {
      let clock = at("2026-11-16T14:00:00");
      const deps = {
        db,
        sms: createFakeSms(),
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "flow-test-opt-out-key",
        link: () => "bojen.se/x/Kp3d9AbC",
      };
      const { runDue } = await jobRunner(db, taskList(deps), () => clock);
      const f = await setup(db);
      const staff = { tenantId: f.tenantId, actor: { type: "staff" as const, id: f.mechanicId } };
      const booked = await createBooking(
        { db, now: () => clock },
        { ...staff, idempotencyKey: "pipeline-book" },
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
      const jobId = booked.visit.jobId;
      const statusOf = async () =>
        (await db.select({ s: job.pipelineStatus }).from(job).where(eq(job.id, jobId)))[0]?.s;
      expect(await statusOf()).toBe("booked");

      clock = at("2026-11-18T10:05:00");
      await changeBooking(
        { db, now: () => clock },
        { ...staff, idempotencyKey: "pipeline-start" },
        booked.visit.id,
        {
          event: "start",
        },
      );
      await changeBooking(
        { db, now: () => clock },
        { ...staff, idempotencyKey: "pipeline-done" },
        booked.visit.id,
        {
          event: "complete",
        },
      );
      expect(await statusOf()).toBe("done");

      // Fortnox (step 8) will send this when the invoice is made.
      await db.insert(domainEvent).values({
        tenantId: f.tenantId,
        aggregateType: "job",
        aggregateId: jobId,
        type: "invoice.created",
        payload: { jobId, invoiceNumber: "1001" },
        actorType: "system",
      });
      await runDue();
      expect(await statusOf()).toBe("invoiced");
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
        clock = at("2026-11-17T08:30:00");
        await receiveSms(
          { db, now: () => clock, optOutKey: deps.optOutKey, classifier: createFakeClassifier() },
          { externalId: "elks-flow-0", from: PHONE, to: FIRM_NUMBER, body: "Ja" },
        );
        // The answer, then the receipt and the confirmation's own event.
        expect((await runDue()).sort()).toEqual(["domain_event", "domain_event", "send_message"]);
        expect(sms.lastTo(PHONE)).toBe(
          "Tack! Bokningen är bekräftad. Du får ungefärlig tid i morgon bitti.",
        );

        // --- F5: put in for Wednesday 07:00, and nothing goes out before. ---
        expect(await pending("visit_eta")).toEqual([at("2026-11-18T07:00:00")]);
        // The reminder and the task to call come due, and find the check answered.
        clock = at("2026-11-18T06:59:00");
        expect(await runDue()).toEqual(["visit_check_reminder", "visit_check_escalation"]);
        expect(sms.lastTo(PHONE)).toContain("Bokningen är bekräftad");
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
        // Start, complete, and the job's card moving to done (step 5.4).
        expect(await runDue()).toEqual(["domain_event", "domain_event", "domain_event"]);
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
            "f3_reply_yes",
            "f5_eta",
            "f7_report",
            "f7_report",
            "f9_reply_poor",
            "f9_survey",
            null, // the customer's answer "Ja"
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
