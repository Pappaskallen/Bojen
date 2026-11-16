import {
  createFakeNameplateReader,
  createFakeStorage,
  createFakeSummarizer,
} from "@bojen/adapters";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  NAMEPLATE_TASK,
  NameplateError,
  POST_CALL_TASK,
  decideNameplate,
  nameplateSuggestions,
  readNameplate,
  runPostCall,
  saveTranscript,
} from "../src/postcall";
import { addPicturesByLink, createShortLink } from "../src/short-links";
import { attachment, call, engine, job, nameplateReading, tenant } from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const NOW = new Date("2027-04-01T08:00:00Z");

const queued = async (tx: Tx, key: string) =>
  [
    ...(await tx.execute<{ identifier: string }>(sql`
      select t.identifier from graphile_worker._private_jobs j
        join graphile_worker._private_tasks t on t.id = j.task_id
       where j.key = ${key}`)),
  ].map((r) => r.identifier);

async function aCall(tx: Tx, tenantId: string, values: Partial<typeof call.$inferInsert> = {}) {
  const [c] = await tx
    .insert(call)
    .values({ tenantId, startedAt: NOW, endedAt: NOW, recordingAllowed: true, ...values })
    .returning();
  if (!c) throw new Error("No call");
  return c;
}

describe("after the call", () => {
  it("keeps the transcript without card or personal numbers, and asks for the summary", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Efterfirman", "+46701119701");
      const c = await aCall(tx, f.tenantId);
      expect(
        await saveTranscript(tx, {
          tenantId: f.tenantId,
          callId: c.id,
          transcript: "Kund: Kortet är 4111 1111 1111 1111 och pnr 811218-9876",
          now: NOW,
        }),
      ).toBe(true);
      const [saved] = await tx.select({ t: call.transcript }).from(call).where(eq(call.id, c.id));
      expect(saved?.t).toBe("Kund: Kortet är [kortnummer] och pnr [personnummer]");
      expect(await queued(tx, `post-call:${c.id}`)).toEqual([POST_CALL_TASK]);
      // Another firm's call is not found.
      const g = await createTenantWithBoat(tx, "Annanfirman", "+46701119702");
      expect(
        await saveTranscript(tx, { tenantId: g.tenantId, callId: c.id, transcript: "x", now: NOW }),
      ).toBe(false);
    });
  });

  it("summarises in five points, keeps the agent's outcome and links the customer's one open job", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Sammanfirman", "+46701119703");
      const c = await aCall(tx, f.tenantId, {
        customerId: f.customerId,
        outcome: "message",
        summary: "Vill bli uppringd om bälgen.",
        transcript: "Kund: Bälgen läcker\nReceptionist: Jag tar ett meddelande.",
      });
      const summarizer = createFakeSummarizer();
      expect(await runPostCall({ db: tx, summarizer }, f.tenantId, c.id)).toBe("summarised");
      const [after] = await tx.select().from(call).where(eq(call.id, c.id));
      expect(after).toMatchObject({
        summary: "- Bälgen läcker\nReceptionistens anteckning: Vill bli uppringd om bälgen.",
        outcome: "message",
        jobId: f.jobId,
      });
      expect(after?.transcript).not.toBeNull();
      // Nothing to summarise: skipped.
      const empty = await aCall(tx, f.tenantId);
      expect(await runPostCall({ db: tx, summarizer }, f.tenantId, empty.id)).toBe("skipped");
    });
  });

  it("does not keep the transcript when the caller said no to the recording", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Inspelfirman", "+46701119704");
      // Two open jobs: which one the call was about is not clear, so none is linked.
      await tx.insert(job).values({
        tenantId: f.tenantId,
        customerId: f.customerId,
        boatId: f.boatId,
        channel: "phone",
      });
      const c = await aCall(tx, f.tenantId, {
        customerId: f.customerId,
        recordingAllowed: false,
        transcript: "Kund: Hej",
      });
      await runPostCall({ db: tx, summarizer: createFakeSummarizer() }, f.tenantId, c.id);
      const [after] = await tx.select().from(call).where(eq(call.id, c.id));
      expect(after).toMatchObject({ transcript: null, summary: "- Hej", jobId: null });
    });
  });
});

describe("type plates", () => {
  async function picture(tx: Tx, name: string, phone: string) {
    const f = await createTenantWithBoat(tx, name, phone);
    const storage = createFakeStorage();
    const code = await createShortLink(tx, "postcall-test-link-key-long-enough", {
      tenantId: f.tenantId,
      visitId: f.visitId,
      purpose: "manage",
      expiresAt: new Date("2027-04-20T06:00:00Z"),
    });
    await addPicturesByLink(
      { db: tx, now: () => NOW, linkKey: "postcall-test-link-key-long-enough", storage },
      code,
      [{ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg" }],
    );
    const [p] = await tx
      .select({ id: attachment.id })
      .from(attachment)
      .where(
        and(eq(attachment.ownerId, f.jobId), sql`${attachment.storageKey} not like '%drev.jpg'`),
      );
    if (!p) throw new Error("No picture");
    // The helper's own suggestion is for the isolation test.
    await tx.delete(nameplateReading).where(eq(nameplateReading.tenantId, f.tenantId));
    return { ...f, storage, attachmentId: p.id };
  }

  it("are read from a picture sent through the link, once, and suggested for the job's boat", async () => {
    await withRollback(async (tx) => {
      const f = await picture(tx, "Skyltfirman", "+46701119705");
      expect(await queued(tx, `nameplate:${f.attachmentId}`)).toEqual([NAMEPLATE_TASK]);
      const reader = createFakeNameplateReader();
      const deps = { db: tx, storage: f.storage, reader };
      expect(await readNameplate(deps, f.tenantId, f.attachmentId)).toBe("suggested");
      expect(reader.calls[0]).toEqual({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg" });
      expect(await nameplateSuggestions(tx, f.tenantId, f.boatId)).toMatchObject([
        { make: "Volvo Penta", model: "D4-300", serialNumber: "2001234567", confidence: 0.9 },
      ]);
      expect(await readNameplate(deps, f.tenantId, f.attachmentId)).toBe("skipped");
      expect(reader.calls).toHaveLength(1);
    });
  });

  it("are not suggested when the model is unsure", async () => {
    await withRollback(async (tx) => {
      const f = await picture(tx, "Osäkerfirman", "+46701119706");
      const reader = createFakeNameplateReader({
        make: "Yamaha",
        model: null,
        serialNumber: null,
        confidence: 0.2,
      });
      expect(
        await readNameplate({ db: tx, storage: f.storage, reader }, f.tenantId, f.attachmentId),
      ).toBe("nothing");
      expect(await nameplateSuggestions(tx, f.tenantId, f.boatId)).toEqual([]);
    });
  });

  it("change the engine only when the mechanic confirms, and only once", async () => {
    await withRollback(async (tx) => {
      const f = await picture(tx, "Bekräftafirman", "+46701119707");
      await readNameplate(
        { db: tx, storage: f.storage, reader: createFakeNameplateReader() },
        f.tenantId,
        f.attachmentId,
      );
      const [s] = await nameplateSuggestions(tx, f.tenantId, f.boatId);
      const actor = { tenantId: f.tenantId, userId: f.mechanicId, role: "mechanic" as const };
      expect(await decideNameplate(tx, actor, s!.id, "confirm")).toEqual({ engineId: f.engineId });
      const [e] = await tx.select().from(engine).where(eq(engine.id, f.engineId));
      expect(e).toMatchObject({ make: "Volvo Penta", model: "D4-300", serialNumber: "2001234567" });
      await expect(decideNameplate(tx, actor, s!.id, "dismiss")).rejects.toThrow(NameplateError);
      expect(await nameplateSuggestions(tx, f.tenantId, f.boatId)).toEqual([]);

      // A second plate onto a new engine: the boat gets one more.
      await tx.delete(nameplateReading).where(eq(nameplateReading.tenantId, f.tenantId));
      await readNameplate(
        { db: tx, storage: f.storage, reader: createFakeNameplateReader() },
        f.tenantId,
        f.attachmentId,
      );
      const [again] = await nameplateSuggestions(tx, f.tenantId, f.boatId);
      const made = await decideNameplate(tx, actor, again!.id, "confirm", "new");
      expect(made.engineId).not.toBe(f.engineId);
      expect(await tx.select().from(engine).where(eq(engine.boatId, f.boatId))).toHaveLength(2);

      // Another firm cannot decide it.
      const g = await createTenantWithBoat(tx, "Främlingsfirman", "+46701119708");
      await expect(
        decideNameplate(
          tx,
          { tenantId: g.tenantId, userId: g.mechanicId, role: "owner" },
          s!.id,
          "confirm",
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  it("leave the engine as it is when dismissed", async () => {
    await withRollback(async (tx) => {
      const f = await picture(tx, "Avfärdafirman", "+46701119709");
      await tx.update(tenant).set({ name: "Avfärdafirman" }).where(eq(tenant.id, f.tenantId));
      await readNameplate(
        { db: tx, storage: f.storage, reader: createFakeNameplateReader() },
        f.tenantId,
        f.attachmentId,
      );
      const [s] = await nameplateSuggestions(tx, f.tenantId, f.boatId);
      const actor = { tenantId: f.tenantId, userId: f.mechanicId, role: "mechanic" as const };
      expect(await decideNameplate(tx, actor, s!.id, "dismiss")).toEqual({ engineId: null });
      const [e] = await tx.select().from(engine).where(eq(engine.id, f.engineId));
      expect(e?.model).toBeNull();
    });
  });
});
