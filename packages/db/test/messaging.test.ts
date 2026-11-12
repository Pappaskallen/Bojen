import { createFakeSms } from "@bojen/adapters";
import type { SmsSender } from "@bojen/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  deliverQueuedMessage,
  optOutNumber,
  queueSms,
  recordDelivery,
  sendCodeSms,
} from "../src/messaging";
import { customer, message, tenant } from "../src/schema";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const KEY = "test-opt-out-key";
const PHONE = "+46701112233";
// 2026-11-12 is winter time in Stockholm, UTC+1.
const at = (stockholm: string) => new Date(`${stockholm}+01:00`);

async function firm(tx: Tx) {
  const [t] = await tx
    .insert(tenant)
    .values({ name: "Jonas Båtservice", settings: { sms: { from: "JonasBat" } } })
    .returning();
  const [c] = await tx
    .insert(customer)
    .values({ tenantId: t!.id, name: "Per Persson", phone: PHONE })
    .returning();
  return { tenantId: t!.id, customerId: c!.id };
}

const ETA = {
  mechanicFirstName: "Jonas",
  boat: "Bustern",
  placeShort: "Bullandö",
  etaFrom: "09:00",
  etaTo: "11:00",
  firm: "Jonas Båtservice",
};

async function jobFor(tx: Tx, messageId: string) {
  const rows = await tx.execute<{ task_identifier: string; run_at: Date; payload: unknown }>(
    sql`select t.identifier as task_identifier, j.run_at, j.payload
        from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id
        where j.key = ${`message:${messageId}`}`,
  );
  return [...rows];
}

describe("queueSms", () => {
  it("an sms at 22:30 is logged and queued until 08:00 the next morning", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      const now = at("2026-11-12T22:30:00");
      const result = await queueSms(
        { db: tx, now: () => now, optOutKey: KEY },
        { tenantId, to: PHONE, customerId },
        "f5_eta",
        ETA,
      );
      expect(result).toMatchObject({ status: "queued", sendAfter: at("2026-11-13T08:00:00") });
      const [row] = await tx.select().from(message).where(eq(message.id, result.messageId));
      expect(row).toMatchObject({
        channel: "sms",
        direction: "outbound",
        template: "f5_eta",
        status: "queued",
        toAddress: PHONE,
        sendAfter: at("2026-11-13T08:00:00"),
      });
      expect(row?.body).toContain("ca kl 09:00-11:00");
      const jobs = await jobFor(tx, result.messageId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.task_identifier).toBe("send_message");
      expect(new Date(jobs[0]!.run_at)).toEqual(at("2026-11-13T08:00:00"));
      expect(jobs[0]?.payload).toEqual({ messageId: result.messageId });
    });
  });

  it("an sms to an opted-out number is stopped and logged as blocked, with no job", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      await optOutNumber(tx, KEY, { tenantId, phone: PHONE, source: "sms_stop" });
      await optOutNumber(tx, KEY, { tenantId, phone: PHONE, source: "sms_stop" });
      const result = await queueSms(
        { db: tx, now: () => at("2026-11-12T10:00:00"), optOutKey: KEY },
        { tenantId, to: PHONE, customerId },
        "f5_eta",
        ETA,
      );
      expect(result).toMatchObject({ status: "blocked", reason: "opted_out" });
      const [row] = await tx.select().from(message).where(eq(message.id, result.messageId));
      expect(row).toMatchObject({ status: "blocked", error: "opted_out", sendAfter: null });
      expect(await jobFor(tx, result.messageId)).toHaveLength(0);
    });
  });

  it("STOPP to one firm does not stop another firm's sms", async () => {
    await withRollback(async (tx) => {
      const a = await firm(tx);
      const b = await firm(tx);
      await optOutNumber(tx, KEY, { tenantId: a.tenantId, phone: PHONE, source: "sms_stop" });
      const result = await queueSms(
        { db: tx, now: () => at("2026-11-12T10:00:00"), optOutKey: KEY },
        { tenantId: b.tenantId, to: PHONE, customerId: b.customerId },
        "f5_eta",
        ETA,
      );
      expect(result.status).toBe("queued");
    });
  });
});

describe("deliverQueuedMessage", () => {
  it("sends once, from the firm's sender, and records the provider's id", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      const now = at("2026-11-12T10:00:00");
      const deps = { db: tx, now: () => now, optOutKey: KEY };
      const sms = createFakeSms();
      const { messageId } = await queueSms(
        deps,
        { tenantId, to: PHONE, customerId },
        "f5_eta",
        ETA,
      );
      expect(await deliverQueuedMessage({ ...deps, sms }, messageId)).toBe("sent");
      expect(await deliverQueuedMessage({ ...deps, sms }, messageId)).toBe("not_queued");
      expect(sms.sent).toHaveLength(1);
      expect(sms.sent[0]).toMatchObject({ to: PHONE, from: "JonasBat" });
      const [row] = await tx.select().from(message).where(eq(message.id, messageId));
      expect(row).toMatchObject({ status: "sent", externalId: "fake-1", sentAt: now });
    });
  });

  it("does not send before its time", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      const deps = { db: tx, now: () => at("2026-11-12T22:30:00"), optOutKey: KEY };
      const sms = createFakeSms();
      const { messageId } = await queueSms(
        deps,
        { tenantId, to: PHONE, customerId },
        "f5_eta",
        ETA,
      );
      expect(await deliverQueuedMessage({ ...deps, sms }, messageId)).toBe("too_early");
      const morning = { ...deps, now: () => at("2026-11-13T08:00:00") };
      expect(await deliverQueuedMessage({ ...morning, sms }, messageId)).toBe("sent");
    });
  });

  it("checks STOPP again just before sending", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      const deps = { db: tx, now: () => at("2026-11-12T22:30:00"), optOutKey: KEY };
      const sms = createFakeSms();
      const { messageId } = await queueSms(
        deps,
        { tenantId, to: PHONE, customerId },
        "f5_eta",
        ETA,
      );
      // The customer replies STOPP during the night.
      await optOutNumber(tx, KEY, { tenantId, phone: PHONE, source: "sms_stop" });
      const morning = { ...deps, now: () => at("2026-11-13T08:00:00") };
      expect(await deliverQueuedMessage({ ...morning, sms }, messageId)).toBe("blocked");
      expect(sms.sent).toHaveLength(0);
      const [row] = await tx.select().from(message).where(eq(message.id, messageId));
      expect(row).toMatchObject({ status: "blocked", error: "opted_out" });
    });
  });

  it("a failed send leaves the message queued for the next attempt", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      const deps = { db: tx, now: () => at("2026-11-12T10:00:00"), optOutKey: KEY };
      const broken: SmsSender = { send: () => Promise.reject(new Error("46elks is down")) };
      const { messageId } = await queueSms(
        deps,
        { tenantId, to: PHONE, customerId },
        "f5_eta",
        ETA,
      );
      await expect(deliverQueuedMessage({ ...deps, sms: broken }, messageId)).rejects.toThrow(
        "46elks is down",
      );
      const [row] = await tx.select().from(message).where(eq(message.id, messageId));
      expect(row?.status).toBe("queued");
    });
  });
});

describe("sendCodeSms", () => {
  it("sends a code at once at night and after STOPP, and never stores it", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      await optOutNumber(tx, KEY, { tenantId, phone: PHONE, source: "sms_stop" });
      const sms = createFakeSms();
      const now = at("2026-11-12T23:40:00");
      await sendCodeSms(
        { db: tx, now: () => now, sms },
        { tenantId, to: PHONE, customerId },
        "booking_code",
        {
          code: "482913",
          firm: "Jonas Båtservice",
        },
      );
      expect(sms.lastTo(PHONE)).toBe("482913 är din kod för att boka hos Jonas Båtservice.");
      const rows = await tx.select().from(message).where(eq(message.tenantId, tenantId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ template: "booking_code", status: "sent", body: null });
      expect(JSON.stringify(rows)).not.toContain("482913");
    });
  });

  it("logs a failed code as failed and passes the error on", async () => {
    await withRollback(async (tx) => {
      const { tenantId } = await firm(tx);
      const broken: SmsSender = { send: () => Promise.reject(new Error("down")) };
      await expect(
        sendCodeSms(
          { db: tx, now: () => at("2026-11-12T10:00:00"), sms: broken },
          { tenantId, to: PHONE },
          "staff_sign_in_code",
          { code: "111222" },
        ),
      ).rejects.toThrow("down");
      const rows = await tx.select().from(message).where(eq(message.tenantId, tenantId));
      expect(rows[0]).toMatchObject({ status: "failed", body: null });
    });
  });
});

describe("recordDelivery", () => {
  it("marks delivered and failed, ignores unknown ids and never takes back delivered", async () => {
    await withRollback(async (tx) => {
      const { tenantId, customerId } = await firm(tx);
      const deps = { db: tx, now: () => at("2026-11-12T10:00:00"), optOutKey: KEY };
      const sms = createFakeSms();
      const { messageId } = await queueSms(
        deps,
        { tenantId, to: PHONE, customerId },
        "f5_eta",
        ETA,
      );
      await deliverQueuedMessage({ ...deps, sms }, messageId);
      const deliveredAt = at("2026-11-12T10:00:04");
      expect(
        await recordDelivery(tx, { externalId: "fake-1", status: "delivered", deliveredAt }),
      ).toBe(true);
      expect(
        await recordDelivery(tx, { externalId: "fake-1", status: "failed", deliveredAt: null }),
      ).toBe(false);
      expect(
        await recordDelivery(tx, { externalId: "nobody", status: "delivered", deliveredAt }),
      ).toBe(false);
      const [row] = await tx
        .select()
        .from(message)
        .where(and(eq(message.id, messageId), eq(message.tenantId, tenantId)));
      expect(row).toMatchObject({ status: "delivered", deliveredAt });
    });
  });
});
