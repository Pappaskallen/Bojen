import {
  createFakeClassifier,
  createFakeEmail,
  createFakeMaps,
  createFakeSms,
} from "@bojen/adapters";
import { isoWeekOf, stockholmDate, stockholmInstant } from "@bojen/core";
import {
  boat,
  campaignRecipient,
  connect,
  createSpringCampaign,
  customer,
  databaseUrl,
  job,
  message,
  receiveSms,
  serviceType,
  startCampaign,
  tenant,
  visit,
  type Database,
} from "@bojen/db";
import { runMigrations } from "@bojen/db/migrate";
import { DEMO_TENANT_ID, seedDemoData, truncateAll } from "@bojen/db/seed";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { JobHelpers } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customerLinks } from "./flows/deps";
import { taskList } from "./tasks";

/**
 * The spring campaign (F11, byggplan step 5.6) on the demo data, whose boats all had their
 * spring service in April 2026: the campaign holds times in the same weeks of 2027, and JA
 * books the time and sends F1. Everything runs in one transaction that is rolled back; the
 * clock is a fake, and so are the senders and the maps.
 */
const url = databaseUrl();
const connection = connect(url);
afterAll(() => connection.close());
beforeAll(() => runMigrations(url), 60_000);

class Rollback extends Error {}
const FIRM_NUMBER = "+46766860009";
const tenantId = DEMO_TENANT_ID;
const helpers = { logger: { info: () => undefined } } as unknown as JobHelpers;

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

/** Runs this transaction's due jobs of the given kinds at the fake time, until none are left. */
async function runner(db: Database, clock: () => Date) {
  const [{ since }] = [...(await db.execute<{ since: Date }>(sql`select now() as since`))] as [
    { since: Date },
  ];
  return async (tasks: ReturnType<typeof taskList>, only: readonly string[]) => {
    const ran: string[] = [];
    for (let i = 0; i < 50; i++) {
      const due = [
        ...(await db.execute<{ id: string; identifier: string; payload: unknown }>(sql`
          select j.id, t.identifier, j.payload
            from graphile_worker._private_jobs j
            join graphile_worker._private_tasks t on t.id = j.task_id
           where j.created_at = ${since} and j.run_at <= ${clock().toISOString()}::timestamptz
             and t.identifier = any(${`{${only.join(",")}}`}::text[])
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
  };
}

describe("the spring campaign (step 5.6)", () => {
  it("holds times in last year's week, and JA books the visit and sends F1", async () => {
    await inRollback(async (db) => {
      await truncateAll(db);
      await seedDemoData(db);
      await db
        .update(tenant)
        .set({
          settings: sql`${tenant.settings} || ${JSON.stringify({ sms: { from: FIRM_NUMBER } })}::jsonb`,
        })
        .where(eq(tenant.id, tenantId));

      // Sunday 10 January 2027 at 18:30, as the spec says.
      let clock = stockholmInstant("2027-01-10", "18:30");
      const sms = createFakeSms();
      const deps = {
        db,
        sms,
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "campaign-test-opt-out-key-long-enough",
        link: customerLinks(db, "campaign-test-short-link-key-long-enough", "bojen.se"),
        maps: createFakeMaps(),
      };
      const tasks = taskList(deps);
      const run = await runner(db, () => clock);

      const services = await db
        .select({ id: serviceType.id, name: serviceType.name })
        .from(serviceType)
        .where(eq(serviceType.tenantId, tenantId));
      const spring = services.find((s) => s.name.startsWith("Vårservice"));
      const layUp = services.find((s) => s.name === "Vinterkonservering");
      if (!spring || !layUp) throw new Error("The demo services are missing");

      const campaignId = await createSpringCampaign(db, tenantId, {
        name: "Vårkampanj 2027",
        year: 2027,
        scheduledAt: clock,
        springServiceIds: [spring.id],
        layUpServiceIds: [layUp.id],
        bookServiceTypeId: spring.id,
        batchSize: 10,
      });
      const started = await startCampaign(deps, tenantId, campaignId);
      // Every demo boat had its spring service last April: all are in segment A.
      const boats = await db.select({ id: boat.id }).from(boat).where(eq(boat.tenantId, tenantId));
      expect(started.recipients).toBe(boats.length);
      // The first round on the first Tuesday at 18:30.
      expect(started.firstRound).toEqual(stockholmInstant("2027-01-12", "18:30"));

      // --- The first round: ten held times, each in the boat's week from last year. ---
      clock = started.firstRound;
      expect(await run(tasks, ["campaign_round"])).toEqual(["campaign_round"]);
      const sent = await db
        .select({
          boatId: campaignRecipient.boatId,
          visitId: campaignRecipient.suggestedVisitId,
          customerId: campaignRecipient.customerId,
        })
        .from(campaignRecipient)
        .where(
          and(eq(campaignRecipient.campaignId, campaignId), eq(campaignRecipient.status, "sent")),
        );
      expect(sent).toHaveLength(10);
      for (const r of sent) {
        const held = (
          await db
            .select({
              status: visit.status,
              start: sql<string>`lower(${visit.timeWindow})`,
            })
            .from(visit)
            .where(eq(visit.id, r.visitId ?? ""))
        )[0];
        const [last] = await db.execute<{ start: string }>(sql`
          select lower(v.time_window) as start from visit v
            join job j on j.tenant_id = v.tenant_id and j.id = v.job_id
           where j.boat_id = ${r.boatId} and j.service_type_id = ${spring.id} and v.status = 'done'
           order by lower(v.time_window) desc limit 1`);
        expect(held?.status).toBe("reserved");
        const heldWeek = isoWeekOf(stockholmDate(new Date(held?.start ?? "")));
        const lastWeek = isoWeekOf(stockholmDate(new Date(last?.start ?? "")));
        expect(heldWeek).toEqual({ year: 2027, week: lastWeek.week });
      }
      // The sms say so, and the next round waits for Wednesday.
      const offers = await db
        .select({ template: message.template, visitId: message.visitId, to: message.toAddress })
        .from(message)
        .where(and(eq(message.tenantId, tenantId), eq(message.template, "f11_spring_a")));
      expect(offers).toHaveLength(10);
      const next = await db.execute<{ run_at: Date }>(sql`
        select j.run_at from graphile_worker._private_jobs j
         where j.key = ${`campaign:${campaignId}`}`);
      expect(new Date([...next][0]?.run_at ?? 0)).toEqual(stockholmInstant("2027-01-13", "18:30"));

      // The held times hold the calendar: the job cards are offers in the pipeline.
      const heldJobs = await db
        .select({ pipeline: job.pipelineStatus, channel: job.channel })
        .from(job)
        .innerJoin(visit, and(eq(visit.tenantId, job.tenantId), eq(visit.jobId, job.id)))
        .where(
          inArray(
            visit.id,
            sent.map((r) => r.visitId ?? ""),
          ),
        );
      expect(heldJobs.every((j) => j.pipeline === "quote" && j.channel === "campaign")).toBe(true);

      // --- The sms go out, and the first customer answers JA. ---
      await run(tasks, ["send_message"]);
      const first = sent[0];
      if (!first?.visitId) throw new Error("No held time");
      const [who] = await db
        .select({ phone: customer.phone })
        .from(customer)
        .where(eq(customer.id, first.customerId));
      clock = new Date(clock.getTime() + 3_600_000);
      await receiveSms(
        { db, now: () => clock, optOutKey: deps.optOutKey, classifier: createFakeClassifier() },
        { externalId: "elks-campaign-ja", from: who?.phone ?? "", to: FIRM_NUMBER, body: "JA" },
      );
      await run(tasks, ["domain_event", "send_message"]);

      const [booked] = await db
        .select({ status: visit.status })
        .from(visit)
        .where(eq(visit.id, first.visitId));
      expect(booked?.status).toBe("booked");
      const [answered] = await db
        .select({ status: campaignRecipient.status, answer: campaignRecipient.answer })
        .from(campaignRecipient)
        .where(eq(campaignRecipient.suggestedVisitId, first.visitId));
      expect(answered).toEqual({ status: "booked", answer: "yes" });
      // F1, the booking confirmation, to the customer for that visit.
      const confirmations = await db
        .select({ to: message.toAddress, status: message.status })
        .from(message)
        .where(and(eq(message.visitId, first.visitId), eq(message.template, "f1_confirmation")));
      expect(confirmations).toEqual([{ to: who?.phone ?? "", status: "sent" }]);
      expect(sms.sent.some((s) => s.to === who?.phone && /Bokat:/.test(s.body))).toBe(true);
    });
  }, 120_000);

  it("ANNAN sends the booking page, NEJ asks about a sale and SÅLD marks it, silence releases the time", async () => {
    await inRollback(async (db) => {
      await truncateAll(db);
      await seedDemoData(db);
      await db
        .update(tenant)
        .set({
          settings: sql`${tenant.settings} || ${JSON.stringify({ sms: { from: FIRM_NUMBER } })}::jsonb`,
        })
        .where(eq(tenant.id, tenantId));
      let clock = stockholmInstant("2027-01-12", "18:30");
      const deps = {
        db,
        sms: createFakeSms(),
        email: createFakeEmail(),
        now: () => clock,
        optOutKey: "campaign-test-opt-out-key-long-enough",
        link: customerLinks(db, "campaign-test-short-link-key-long-enough", "bojen.se"),
        maps: createFakeMaps(),
      };
      const tasks = taskList(deps);
      const run = await runner(db, () => clock);
      const [spring] = await db
        .select({ id: serviceType.id })
        .from(serviceType)
        .where(
          and(eq(serviceType.tenantId, tenantId), sql`${serviceType.name} like 'Vårservice%'`),
        );
      if (!spring) throw new Error("The demo service is missing");
      const campaignId = await createSpringCampaign(db, tenantId, {
        name: "Vårkampanj 2027",
        year: 2027,
        scheduledAt: clock,
        springServiceIds: [spring.id],
        layUpServiceIds: [],
        bookServiceTypeId: spring.id,
        batchSize: 3,
      });
      await startCampaign(deps, tenantId, campaignId);
      await run(tasks, ["campaign_round"]);
      await run(tasks, ["send_message"]);
      const sent = await db
        .select({
          visitId: campaignRecipient.suggestedVisitId,
          boatId: campaignRecipient.boatId,
          phone: customer.phone,
        })
        .from(campaignRecipient)
        .innerJoin(customer, eq(customer.id, campaignRecipient.customerId))
        .where(
          and(eq(campaignRecipient.campaignId, campaignId), eq(campaignRecipient.status, "sent")),
        );
      expect(sent).toHaveLength(3);
      const [other, no, silent] = sent as [(typeof sent)[0], (typeof sent)[0], (typeof sent)[0]];
      let n = 0;
      const answer = async (from: string | null, body: string) => {
        clock = new Date(clock.getTime() + 60_000);
        await receiveSms(
          { db, now: () => clock, optOutKey: deps.optOutKey, classifier: createFakeClassifier() },
          { externalId: `elks-campaign-${String(++n)}`, from: from ?? "", to: FIRM_NUMBER, body },
        );
        await run(tasks, ["domain_event", "send_message"]);
      };
      const statusOf = async (visitId: string | null) =>
        (
          await db
            .select({ s: visit.status })
            .from(visit)
            .where(eq(visit.id, visitId ?? ""))
        )[0]?.s;
      const lastTo = async (to: string | null) =>
        (
          await db
            .select({ template: message.template })
            .from(message)
            .where(and(eq(message.toAddress, to ?? ""), eq(message.direction, "outbound")))
            .orderBy(sql`${message.createdAt} desc`)
            .limit(1)
        )[0]?.template;

      // ANNAN: the time is released and the booking page comes by sms.
      await answer(other.phone, "ANNAN");
      expect(await statusOf(other.visitId)).toBe("cancelled");
      expect(await lastTo(other.phone)).toBe("f11_other_times");

      // NEJ: released, declined, and the question whether the boat is sold; SÅLD marks it.
      await answer(no.phone, "NEJ");
      expect(await statusOf(no.visitId)).toBe("cancelled");
      expect(await lastTo(no.phone)).toBe("f11_sold_question");
      await answer(no.phone, "SÅLD");
      const [soldBoat] = await db
        .select({ status: boat.status })
        .from(boat)
        .where(eq(boat.id, no.boatId ?? ""));
      expect(soldBoat?.status).toBe("sold");

      // No answer in 14 days: released, and the freed time does not start the waitlist.
      clock = new Date(clock.getTime() + 15 * 86_400_000);
      const released = await run(tasks, ["campaign_release", "domain_event"]);
      expect(released.filter((t) => t === "campaign_release")).toHaveLength(3);
      expect(await statusOf(silent.visitId)).toBe("cancelled");
      const waitlist = await db.execute(sql`
        select 1 from graphile_worker._private_jobs j
          join graphile_worker._private_tasks t on t.id = j.task_id
         where t.identifier = 'waitlist_round' and j.payload ->> 'visitId' = ${silent.visitId}`);
      expect([...waitlist]).toHaveLength(0);

      const rows = await db
        .select({ status: campaignRecipient.status, answer: campaignRecipient.answer })
        .from(campaignRecipient)
        .where(
          inArray(
            campaignRecipient.suggestedVisitId,
            sent.map((s) => s.visitId ?? ""),
          ),
        );
      expect(rows).toEqual(
        expect.arrayContaining([
          { status: "sent", answer: "other" },
          { status: "declined", answer: "sold" },
          { status: "no_reply", answer: null },
        ]),
      );
    });
  }, 120_000);
});
