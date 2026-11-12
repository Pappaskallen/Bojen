import { createFakeClassifier } from "@bojen/adapters";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { receiveSms } from "../src/inbound";
import { isOptedOut, queueSms } from "../src/messaging";
import { message, task, tenant, visit } from "../src/schema";
import { timeRange } from "../src/schema/_types";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const KEY = "test-opt-out-key";
const FIRM_NUMBER = "+46766860001";
const PHONE = "+46701112244";
const NOW = new Date("2026-11-12T10:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

/** A firm with its sms number, a customer, and visit A (passed) and B (tomorrow). */
async function setup(tx: Tx) {
  const f = await createTenantWithBoat(tx, "Svarsfirman", PHONE);
  await tx
    .update(tenant)
    .set({ settings: { sms: { from: FIRM_NUMBER } } })
    .where(eq(tenant.id, f.tenantId));
  await tx
    .update(visit)
    .set({ timeWindow: timeRange(hours(-24 * 7), hours(-24 * 7 + 4)) })
    .where(eq(visit.id, f.visitId));
  const [b] = await tx
    .insert(visit)
    .values({
      tenantId: f.tenantId,
      jobId: f.jobId,
      mechanicId: f.mechanicId,
      timeWindow: timeRange(hours(22), hours(26)),
      plannedMinutes: 120,
      status: "booked",
    })
    .returning();
  const classifier = createFakeClassifier();
  const deps = { db: tx, now: () => NOW, optOutKey: KEY, classifier };
  return { ...f, visitA: f.visitId, visitB: b!.id, classifier, deps };
}

/** A question as the log has it once sent. */
async function asked(
  tx: Tx,
  f: { tenantId: string; customerId: string },
  template: string,
  sentAt: Date,
  visitId: string | null,
) {
  const [row] = await tx
    .insert(message)
    .values({
      tenantId: f.tenantId,
      channel: "sms",
      direction: "outbound",
      template,
      customerId: f.customerId,
      visitId,
      toAddress: PHONE,
      body: "…",
      status: "sent",
      sentAt,
    })
    .returning();
  return row!.id;
}

let n = 0;
const sms = (body: string, from = PHONE) => ({
  externalId: `elks-${String(++n)}`,
  from,
  to: FIRM_NUMBER,
  body,
});

describe("receiveSms", () => {
  it("links JA to the newest open question and its visit, without a task", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await asked(tx, f, "f3_check_water", hours(-24 * 8), f.visitA);
      const questionB = await asked(tx, f, "f3_check_water", hours(-2), f.visitB);

      const result = await receiveSms(f.deps, sms("Ja!"));
      expect(result).toMatchObject({
        status: "received",
        kind: "availability_check",
        questionId: questionB,
        interpretation: { intent: "yes", confidence: 1, source: "rule" },
        taskId: null,
      });
      if (result.status !== "received") throw new Error();
      const [row] = await tx.select().from(message).where(eq(message.id, result.messageId));
      expect(row).toMatchObject({
        direction: "inbound",
        status: "received",
        fromAddress: PHONE,
        toAddress: FIRM_NUMBER,
        intent: "yes",
        intentConfidence: 1,
        replyToId: questionB,
        visitId: f.visitB,
        customerId: f.customerId,
      });
      expect(f.classifier.calls).toHaveLength(0);
    });
  });

  it("a reply to an older question is not linked to the wrong visit", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      // Only last week's check is in the log; visit A is over, so the question is closed.
      await asked(tx, f, "f3_check_water", hours(-24 * 8), f.visitA);
      const result = await receiveSms(f.deps, sms("ja"));
      if (result.status !== "received") throw new Error(result.status);
      expect(result).toMatchObject({ kind: "none", questionId: null });
      const [row] = await tx.select().from(message).where(eq(message.id, result.messageId));
      expect(row).toMatchObject({ replyToId: null, visitId: null, customerId: f.customerId });
      // Without a question "ja" means nothing certain: a person reads it.
      expect(result.taskId).not.toBeNull();
    });
  });

  it("a question already answered takes no second reply", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const questionB = await asked(tx, f, "f3_check_water", hours(-2), f.visitB);
      const first = await receiveSms(f.deps, sms("JA"));
      const second = await receiveSms(f.deps, sms("ja"));
      expect(first).toMatchObject({ questionId: questionB });
      expect(second).toMatchObject({ questionId: null, kind: "none" });
    });
  });

  it("free text goes to the model; under 90 % it becomes a task with the text", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await asked(tx, f, "f3_check_water", hours(-2), f.visitB);
      f.classifier.answer("Ja men nyckeln ligger hos grannen", {
        intent: "change",
        confidence: 0.82,
      });
      f.classifier.answer("Kan ni komma på torsdag istället?", {
        intent: "change",
        confidence: 0.96,
      });

      const unsure = await receiveSms(f.deps, sms("Ja men nyckeln ligger hos grannen"));
      if (unsure.status !== "received") throw new Error();
      expect(unsure.interpretation).toMatchObject({ intent: "change", source: "model" });
      expect(f.classifier.calls[0]).toEqual({
        reply: "Ja men nyckeln ligger hos grannen",
        question: "availability_check",
        allowed: ["yes", "no", "change", "stop", "unclear"],
      });
      const [t] = await tx
        .select()
        .from(task)
        .where(eq(task.id, unsure.taskId ?? ""));
      expect(t).toMatchObject({
        type: "unclear_reply",
        status: "open",
        note: "Ja men nyckeln ligger hos grannen",
        visitId: f.visitB,
        messageId: unsure.messageId,
      });
      expect(t?.title).toContain("Svarsfirman kund");
    });
  });

  it("a sure answer from the model needs no person", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await asked(tx, f, "f3_check_water", hours(-2), f.visitB);
      f.classifier.answer("Kan ni komma på torsdag istället?", {
        intent: "change",
        confidence: 0.96,
      });
      const sure = await receiveSms(f.deps, sms("Kan ni komma på torsdag istället?"));
      expect(sure).toMatchObject({ interpretation: { intent: "change" }, taskId: null });
    });
  });

  it("a model that fails or answers something not asked for leaves the reply to a person", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await asked(tx, f, "f9_survey", hours(-3), f.visitA);
      f.classifier.answer("bra", { intent: "yes", confidence: 0.99 });
      const notAsked = await receiveSms(f.deps, sms("bra"));
      expect(notAsked).toMatchObject({ interpretation: { intent: "unclear", confidence: 0 } });
      expect(notAsked.status === "received" && notAsked.taskId).toBeTruthy();

      const broken = {
        ...f.deps,
        classifier: { classify: () => Promise.reject(new Error("down")) },
      };
      await asked(tx, f, "f9_survey", hours(-1), f.visitA);
      const failed = await receiveSms(broken, sms("helt ok tycker jag"));
      expect(failed).toMatchObject({ interpretation: { intent: "unclear", source: "none" } });
    });
  });

  it("a score answers the satisfaction question", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const survey = await asked(tx, f, "f9_survey", hours(-3), f.visitA);
      const result = await receiveSms(f.deps, sms("5"));
      if (result.status !== "received") throw new Error();
      expect(result).toMatchObject({
        questionId: survey,
        interpretation: { intent: "rating", rating: 5 },
      });
      const [row] = await tx.select().from(message).where(eq(message.id, result.messageId));
      expect(row?.rating).toBe(5);
    });
  });

  it("STOPP opts the number out and sends one receipt; later sms are stopped", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await asked(tx, f, "f11_spring_a", hours(-24), null);
      const result = await receiveSms(f.deps, sms("STOPP"));
      expect(result).toMatchObject({ interpretation: { intent: "stop" }, taskId: null });
      expect(await isOptedOut(tx, KEY, f.tenantId, PHONE)).toBe(true);

      const receipts = await tx
        .select()
        .from(message)
        .where(and(eq(message.tenantId, f.tenantId), eq(message.template, "stop_receipt")));
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ status: "queued", toAddress: PHONE });
      expect(receipts[0]?.body).toBe("Du är avregistrerad och får inga fler sms från Svarsfirman.");

      const later = await queueSms(f.deps, { tenantId: f.tenantId, to: PHONE }, "f6_on_way", {
        mechanicFirstName: "Jonas",
        placeShort: "Bullandö",
        eta: "10:15",
        firm: "Svarsfirman",
      });
      expect(later).toMatchObject({ status: "blocked", reason: "opted_out" });
    });
  });

  it("the same sms from 46elks twice is handled once", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const once = sms("ja");
      const first = await receiveSms(f.deps, once);
      const again = await receiveSms(f.deps, once);
      expect(again).toEqual({
        status: "duplicate",
        messageId: first.status === "received" ? first.messageId : "",
      });
    });
  });

  it("an sms to a number no firm has is ignored", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const result = await receiveSms(f.deps, { ...sms("ja"), to: "+46766869999" });
      expect(result).toEqual({ status: "unknown_number" });
    });
  });
});
