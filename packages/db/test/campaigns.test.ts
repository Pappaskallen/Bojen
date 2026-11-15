import { optOutHash } from "@bojen/core/messaging";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  CampaignError,
  createSpringCampaign,
  segmentCounts,
  springBoats,
  startCampaign,
} from "../src/campaigns";
import { BookingError, createBooking } from "../src/booking";
import { acceptByLink, createShortLink } from "../src/short-links";
import { timeRange } from "../src/schema/_types";
import {
  boat,
  campaign,
  campaignRecipient,
  customer,
  job,
  serviceType,
  smsOptOut,
  task,
  visit,
} from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const KEY = "campaign-db-test-opt-out-key-long-enough";
const LINK_KEY = "campaign-db-test-short-link-key-long-enough";
/** The helper's visit is booked in April 2027, so these tests plan the spring of 2028. */
const YEAR = 2028;

/** A firm whose boat had its spring service in April 2027. */
async function setUp(tx: Tx, name: string, phone: string) {
  const f = await createTenantWithBoat(tx, name, phone);
  const [st] = await tx.select().from(serviceType).where(eq(serviceType.tenantId, f.tenantId));
  if (!st) throw new Error("No service");
  await tx.update(visit).set({ status: "done" }).where(eq(visit.id, f.visitId));
  const rules = { year: YEAR, springServiceIds: [st.id], layUpServiceIds: [] };
  const deps = { db: tx, optOutKey: KEY };
  const result = async () => (await springBoats(deps, f.tenantId, rules))[0]?.result;
  return { ...f, serviceTypeId: st.id, rules, deps, result };
}

describe("the spring campaign's recipients", () => {
  it("are last spring's boats, in segment A, until something leaves them out", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Kampanjfirman", "+46701119501");
      expect(await f.result()).toEqual({ segment: "A" });

      // Booked for this spring already.
      const [j] = await tx
        .insert(job)
        .values({
          tenantId: f.tenantId,
          customerId: f.customerId,
          boatId: f.boatId,
          serviceTypeId: f.serviceTypeId,
          channel: "phone",
        })
        .returning();
      const [later] = await tx
        .insert(visit)
        .values({
          tenantId: f.tenantId,
          jobId: j!.id,
          mechanicId: f.mechanicId,
          timeWindow: timeRange(new Date("2028-04-18T06:00:00Z"), new Date("2028-04-18T08:00:00Z")),
          plannedMinutes: 120,
          status: "booked",
        })
        .returning();
      expect(await f.result()).toEqual({ excluded: "booked" });
      // A cancelled one does not count.
      await tx.update(visit).set({ status: "cancelled" }).where(eq(visit.id, later!.id));
      expect(await f.result()).toEqual({ segment: "A" });

      // A rating of 1–2 whose follow-up is open.
      const [t] = await tx
        .insert(task)
        .values({
          tenantId: f.tenantId,
          type: "low_csat",
          title: "Ring kunden",
          customerId: f.customerId,
        })
        .returning();
      expect(await f.result()).toEqual({ excluded: "low_rating" });
      await tx.update(task).set({ status: "done" }).where(eq(task.id, t!.id));
      expect(await f.result()).toEqual({ segment: "A" });

      // STOPP from the customer's number.
      const [c] = await tx.select().from(customer).where(eq(customer.id, f.customerId));
      await tx.insert(smsOptOut).values({
        tenantId: f.tenantId,
        phoneHash: optOutHash(KEY, f.tenantId, c!.phone!),
        source: "sms_stop",
      });
      expect(await f.result()).toEqual({ excluded: "opted_out" });
      await tx.delete(smsOptOut).where(eq(smsOptOut.tenantId, f.tenantId));

      // Sold.
      await tx.update(boat).set({ status: "sold" }).where(eq(boat.id, f.boatId));
      expect(await f.result()).toEqual({ excluded: "sold" });
      expect(segmentCounts(await springBoats(f.deps, f.tenantId, f.rules))).toEqual({
        A: 0,
        B: 0,
        excluded: { sold: 1 },
      });
    });
  });

  it("are laid-up boats without a spring service in segment B", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Höstfirman", "+46701119502");
      // The visit becomes last autumn's lay-up, not last spring's service.
      await tx
        .update(visit)
        .set({
          timeWindow: timeRange(new Date("2027-10-12T06:00:00Z"), new Date("2027-10-12T08:00:00Z")),
        })
        .where(eq(visit.id, f.visitId));
      const boats = await springBoats(f.deps, f.tenantId, {
        ...f.rules,
        springServiceIds: [],
        layUpServiceIds: [f.serviceTypeId],
      });
      expect(boats[0]).toMatchObject({ result: { segment: "B" }, laidUpLastAutumn: true });
    });
  });

  it("become the campaign's when it starts, once, and the first round is planned", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Startfirman", "+46701119503");
      const now = new Date("2028-01-10T17:30:00Z");
      const id = await createSpringCampaign(tx, f.tenantId, {
        name: "Vårkampanj 2028",
        year: YEAR,
        scheduledAt: now,
        springServiceIds: [f.serviceTypeId],
        layUpServiceIds: [],
        bookServiceTypeId: f.serviceTypeId,
      });
      const started = await startCampaign({ ...f.deps, now: () => now }, f.tenantId, id);
      expect(started.recipients).toBe(1);
      expect(started.firstRound.toISOString()).toBe("2028-01-11T17:30:00.000Z");
      const recipients = await tx
        .select({ segment: campaignRecipient.segment, status: campaignRecipient.status })
        .from(campaignRecipient)
        .where(eq(campaignRecipient.campaignId, id));
      expect(recipients).toEqual([{ segment: "A", status: "pending" }]);
      const [c] = await tx.select().from(campaign).where(eq(campaign.id, id));
      expect(c?.status).toBe("scheduled");
      await expect(startCampaign({ ...f.deps, now: () => now }, f.tenantId, id)).rejects.toThrow(
        CampaignError,
      );
      // A campaign needs a name and some service to look for.
      await expect(
        createSpringCampaign(tx, f.tenantId, {
          name: " ",
          year: YEAR,
          scheduledAt: now,
          springServiceIds: [],
          layUpServiceIds: [],
          bookServiceTypeId: f.serviceTypeId,
        }),
      ).rejects.toThrow(CampaignError);
    });
  });
});

describe("the held time from the e-mail's link", () => {
  it("is booked by the customer's link once, and the campaign counts it as JA", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Länkfirman", "+46701119504");
      const now = new Date("2028-01-12T17:30:00Z");
      const id = await createSpringCampaign(tx, f.tenantId, {
        name: "Vårkampanj 2028",
        year: YEAR,
        scheduledAt: now,
        springServiceIds: [f.serviceTypeId],
        layUpServiceIds: [],
        bookServiceTypeId: f.serviceTypeId,
      });
      await startCampaign({ ...f.deps, now: () => now }, f.tenantId, id);
      const held = await createBooking(
        { db: tx, now: () => now },
        { tenantId: f.tenantId, actor: { type: "system", id: null }, idempotencyKey: "held-1" },
        {
          customerId: f.customerId,
          boatId: f.boatId,
          serviceTypeId: f.serviceTypeId,
          mechanicId: f.mechanicId,
          start: new Date("2028-04-17T06:00:00Z"),
          channel: "campaign",
          needsApproval: false,
          partsMissing: false,
          reserved: true,
        },
      );
      expect(held.visit.status).toBe("reserved");
      await tx
        .update(campaignRecipient)
        .set({ status: "sent", sentAt: now, suggestedVisitId: held.visit.id })
        .where(eq(campaignRecipient.campaignId, id));
      const code = await createShortLink(tx, LINK_KEY, {
        tenantId: f.tenantId,
        visitId: held.visit.id,
        purpose: "manage",
        expiresAt: new Date("2028-04-17T06:00:00Z"),
      });
      const deps = { db: tx, now: () => now, linkKey: LINK_KEY };

      await acceptByLink(deps, code);
      const [v] = await tx
        .select({ s: visit.status })
        .from(visit)
        .where(eq(visit.id, held.visit.id));
      expect(v?.s).toBe("booked");
      const [r] = await tx
        .select({ status: campaignRecipient.status, answer: campaignRecipient.answer })
        .from(campaignRecipient)
        .where(eq(campaignRecipient.campaignId, id));
      expect(r).toEqual({ status: "booked", answer: "yes" });
      // The link is used up, and a booked visit is not held any more.
      await expect(acceptByLink(deps, code)).rejects.toThrow(BookingError);
    });
  });
});
