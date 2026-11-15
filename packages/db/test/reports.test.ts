import { createFakeReportWriter, createFakeStorage, createFakeTranscriber } from "@bojen/adapters";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { changeBooking, type BookingContext } from "../src/booking";
import {
  DayError,
  addPart,
  addVoiceNote,
  dayVisits,
  recordHours,
  saveNote,
  visitBoatPicture,
} from "../src/day";
import {
  REPORT_TASK,
  ReportError,
  addInvoiceLine,
  approveReport,
  removeInvoiceLine,
  reportView,
  saveReport,
  writeReportDraft,
} from "../src/reports";
import {
  appUser,
  attachment,
  domainEvent,
  jobLine,
  part,
  serviceReport,
  serviceType,
  tenant,
} from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

/** The helper's visit is 20 April 2027 06:00–08:00Z. */
const DURING = new Date("2027-04-20T07:00:00Z");
const AFTER = new Date("2027-04-20T09:00:00Z");

/** A firm whose visit is started, with prices, ready to be marked done. */
async function setUp(tx: Tx, name: string, phone: string) {
  const f = await createTenantWithBoat(tx, name, phone);
  // The helper's report and invoice line are for the isolation test; this one starts clean.
  await tx.delete(serviceReport).where(eq(serviceReport.tenantId, f.tenantId));
  await tx.delete(jobLine).where(eq(jobLine.tenantId, f.tenantId));
  await tx
    .update(tenant)
    .set({
      settings: {
        booking: { calloutPriceOre: 69_500, hourlyRateOre: 95_000, emergencySurchargeOre: 180_000 },
      },
    })
    .where(eq(tenant.id, f.tenantId));
  await tx
    .update(serviceType)
    .set({ priceOre: 250_000 })
    .where(eq(serviceType.tenantId, f.tenantId));
  await tx.update(part).set({ salePriceOre: 45_000 }).where(eq(part.tenantId, f.tenantId));
  const actor = { tenantId: f.tenantId, userId: f.mechanicId, role: "mechanic" as const };
  let n = 0;
  const ctx = (): BookingContext => ({
    tenantId: f.tenantId,
    actor: { type: "staff", id: f.mechanicId },
    idempotencyKey: `${name}-${String(++n)}`,
  });
  const at = (when: Date) => ({ db: tx, now: () => when });
  await changeBooking(at(DURING), ctx(), f.visitId, { event: "start" });
  const done = () => changeBooking(at(AFTER), ctx(), f.visitId, { event: "complete" });
  const storage = createFakeStorage();
  const draftDeps = (writer = createFakeReportWriter(), transcriber = createFakeTranscriber()) => ({
    db: tx,
    storage,
    writer,
    transcriber,
    now: () => AFTER,
  });
  return { ...f, actor, done, storage, draftDeps };
}

const report = async (tx: Tx, visitId: string) =>
  (await tx.select().from(serviceReport).where(eq(serviceReport.visitId, visitId)))[0];

const queued = async (tx: Tx, visitId: string) => [
  ...(await tx.execute<{ identifier: string; payload: unknown }>(
    sql`select t.identifier, j.payload
          from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id
          where j.key = ${`report:${visitId}`}`,
  )),
];

const input = (workDone: string) => ({
  workDone,
  recommendations: [{ text: "Byt bälgen", priority: "next_season" }],
  nextService: "Vårservice v. 17",
});

describe("the service report", () => {
  it("starts when the visit is done: it waits for its draft and the price list gives the lines", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Rapportfirman", "+46701119401");
      expect(await report(tx, f.visitId)).toBeUndefined();
      await f.done();
      expect(await report(tx, f.visitId)).toMatchObject({ status: "drafting", workDone: null });
      expect(await queued(tx, f.visitId)).toEqual([
        { identifier: REPORT_TASK, payload: { tenantId: f.tenantId, visitId: f.visitId } },
      ]);
      const lines = await tx.select().from(jobLine).where(eq(jobLine.jobId, f.jobId));
      expect(lines.map((l) => [l.type, l.description, l.unitPriceOre])).toEqual([
        ["labour", "Vårservice", 250_000],
        ["callout", "Framkörning", 69_500],
      ]);
      // The day view shows it.
      const [day] = await dayVisits(tx, f.tenantId, f.mechanicId, "2027-04-20");
      expect(day).toMatchObject({ status: "done", report: "drafting" });
    });
  });

  it("is drafted from the notes, the parts and the voice notes, written out first", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Utkastfirman", "+46701119402");
      await recordHours(tx, f.actor, f.visitId, f.engineId, 430, DURING);
      await addPart(tx, f.actor, f.visitId, { articleNumber: "21951346" });
      await saveNote(tx, f.actor, f.visitId, "Bytt olja. Bälgen sliten.");
      await addVoiceNote({ db: tx, storage: f.storage }, f.actor, f.visitId, {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "audio/webm;codecs=opus",
      });
      await f.done();

      const writer = createFakeReportWriter();
      const transcriber = createFakeTranscriber("Impellern hade två skadade vingar.");
      expect(await writeReportDraft(f.draftDeps(writer, transcriber), f.tenantId, f.visitId)).toBe(
        "drafted",
      );
      expect(transcriber.calls).toEqual([
        { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/webm" },
      ]);
      const facts = writer.calls[0];
      expect(facts).toMatchObject({
        service: "Vårservice",
        engines: [{ hours: 430, previousHours: 412.5 }],
        notes: "Bytt olja. Bälgen sliten.",
        voiceNotes: ["Impellern hade två skadade vingar."],
        photos: 0,
      });
      // Nothing about who the customer is goes to the writer.
      expect(JSON.stringify(facts)).not.toMatch(/kund|\+46/);
      expect(await report(tx, f.visitId)).toMatchObject({
        status: "draft",
        draftedBy: "fake",
        draftedAt: AFTER,
        workDone:
          "Utfört: Vårservice\nMonterat impeller\nBytt olja\nBälgen sliten\nImpellern hade två skadade vingar",
      });
      // Run again (a retry): nothing new.
      expect(await writeReportDraft(f.draftDeps(writer), f.tenantId, f.visitId)).toBe("skipped");
      expect(writer.calls).toHaveLength(1);
    });
  });

  it("stays waiting when the writer fails, so the worker tries again", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Felfirman", "+46701119403");
      await f.done();
      const writer = createFakeReportWriter();
      writer.failNext(1);
      await expect(writeReportDraft(f.draftDeps(writer), f.tenantId, f.visitId)).rejects.toThrow();
      expect(await report(tx, f.visitId)).toMatchObject({ status: "drafting" });
      expect(await writeReportDraft(f.draftDeps(writer), f.tenantId, f.visitId)).toBe("drafted");
    });
  });

  it("keeps what the mechanic wrote: a draft that comes later does not overwrite it", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Egenfirman", "+46701119404");
      await f.done();
      await saveReport(tx, f.actor, f.visitId, input("- Bytt impeller\n- Smort styrning"));
      expect(await writeReportDraft(f.draftDeps(), f.tenantId, f.visitId)).toBe("skipped");
      expect(await report(tx, f.visitId)).toMatchObject({
        status: "draft",
        draftedBy: "mechanic",
        workDone: "Bytt impeller\nSmort styrning",
        recommendations: [{ text: "Byt bälgen", priority: "next_season" }],
        nextService: "Vårservice v. 17",
      });
      await expect(
        saveReport(tx, f.actor, f.visitId, {
          ...input("x"),
          recommendations: [{ text: "Något", priority: "akut" }],
        }),
      ).rejects.toThrow(ReportError);
    });
  });

  it("has an invoice basis the mechanic changes: extra hours, a discount, parts at their price", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Fakturafirman", "+46701119405");
      await addPart(tx, f.actor, f.visitId, { articleNumber: "21951346", quantity: 2 });
      await addPart(tx, f.actor, f.visitId, { articleNumber: "NY-1", description: "Zinkanod" });
      await f.done();
      await addInvoiceLine(tx, f.actor, f.visitId, {
        type: "labour",
        description: "Extra timmar",
        quantity: 1.5,
        unitPriceOre: 95_000,
      });
      const discount = await addInvoiceLine(tx, f.actor, f.visitId, {
        type: "discount",
        description: "Rabatt",
        quantity: 1,
        unitPriceOre: -20_000,
      });
      // A discount must be negative, and nothing else may be.
      await expect(
        addInvoiceLine(tx, f.actor, f.visitId, {
          type: "labour",
          description: "Fel",
          quantity: 1,
          unitPriceOre: -1,
        }),
      ).rejects.toThrow(ReportError);

      let view = await reportView(tx, f.actor, f.visitId);
      expect(view.lines.map((l) => [l.type, l.quantity, l.amountOre, l.noPrice ?? false])).toEqual([
        ["labour", 1, 250_000, false],
        ["callout", 1, 69_500, false],
        ["labour", 1.5, 142_500, false],
        ["discount", 1, -20_000, false],
        ["part", 2, 90_000, false],
        // The part the firm has no price for is shown, but not summed.
        ["part", 1, 0, true],
      ]);
      expect(view).toMatchObject({ netOre: 532_000, vatOre: 133_000, grossOre: 665_000 });
      expect(view.hourlyRateOre).toBe(95_000);

      await removeInvoiceLine(tx, f.actor, f.visitId, discount);
      view = await reportView(tx, f.actor, f.visitId);
      expect(view.netOre).toBe(552_000);
      await expect(removeInvoiceLine(tx, f.actor, f.visitId, discount)).rejects.toThrow(
        ReportError,
      );
    });
  });

  it("is approved once: the customer gets it (F7), and the text and the basis are fixed", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Godkännfirman", "+46701119406");
      await recordHours(tx, f.actor, f.visitId, f.engineId, 430, DURING);
      await addPart(tx, f.actor, f.visitId, { articleNumber: "21951346" });
      await f.done();
      await writeReportDraft(f.draftDeps(), f.tenantId, f.visitId);

      await expect(
        approveReport({ db: tx, now: () => AFTER }, f.actor, f.visitId, input("  ")),
      ).rejects.toMatchObject({ code: "empty" });
      await approveReport(
        { db: tx, now: () => AFTER },
        f.actor,
        f.visitId,
        input("Bytt impeller\nBytt olja"),
      );

      const r = await report(tx, f.visitId);
      expect(r).toMatchObject({
        status: "approved",
        approvedAt: AFTER,
        approvedBy: f.mechanicId,
        workDone: "Bytt impeller\nBytt olja",
        invoice: { netOre: 364_500, vatOre: 91_125, grossOre: 455_625 },
      });
      const [event] = await tx
        .select()
        .from(domainEvent)
        .where(
          and(eq(domainEvent.aggregateId, f.visitId), eq(domainEvent.type, "report.approved")),
        );
      expect(event?.payload).toEqual({
        visitId: f.visitId,
        workDone: "- Bytt impeller\n- Bytt olja",
        hours: "Motor: 430 h",
        previousHours: "Motor: 412,5 h",
        parts: "- Impeller (art.nr 21951346) × 1",
        recommendations: "- Nästa säsong: Byt bälgen",
        nextService: "Vårservice v. 17",
      });

      // After the approval nothing changes, and a second approval sends nothing.
      for (const attempt of [
        () => saveReport(tx, f.actor, f.visitId, input("Annat")),
        () =>
          addInvoiceLine(tx, f.actor, f.visitId, {
            type: "labour",
            description: "Mer",
            quantity: 1,
            unitPriceOre: 1,
          }),
        () => approveReport({ db: tx, now: () => AFTER }, f.actor, f.visitId, input("Igen")),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ code: "approved" });
      }
      const events = await tx
        .select()
        .from(domainEvent)
        .where(
          and(eq(domainEvent.aggregateId, f.visitId), eq(domainEvent.type, "report.approved")),
        );
      expect(events).toHaveLength(1);
      // The page shows the approved basis, even if the job's lines change later.
      await tx.update(jobLine).set({ unitPriceOre: 1 }).where(eq(jobLine.jobId, f.jobId));
      expect((await reportView(tx, f.actor, f.visitId)).grossOre).toBe(455_625);
    });
  });

  it("is only for the visit's own mechanic, the owner and an administrator", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Behörighetsfirman", "+46701119407");
      await f.done();
      const [other] = await tx
        .insert(appUser)
        .values({ tenantId: f.tenantId, name: "Annan", role: "mechanic" })
        .returning();
      const stranger = { tenantId: f.tenantId, userId: other!.id, role: "mechanic" as const };
      await expect(reportView(tx, stranger, f.visitId)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(saveReport(tx, stranger, f.visitId, input("x"))).rejects.toMatchObject({
        code: "forbidden",
      });
      const owner = { ...stranger, role: "owner" as const };
      expect((await reportView(tx, owner, f.visitId)).status).toBe("drafting");
      // Another firm does not find it.
      const g = await createTenantWithBoat(tx, "Grannfirman", "+46701119408");
      await expect(
        reportView(tx, { tenantId: g.tenantId, userId: g.mechanicId, role: "owner" }, f.visitId),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  it("takes voice notes only as audio of the known kinds, and counts them apart from pictures", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Röstfirman", "+46701119409");
      const deps = { db: tx, storage: f.storage };
      for (const bad of [
        { bytes: new Uint8Array([1]), contentType: "image/png" },
        { bytes: new Uint8Array(), contentType: "audio/webm" },
        { bytes: new Uint8Array(12 * 1024 * 1024 + 1), contentType: "audio/mpeg" },
      ]) {
        await expect(addVoiceNote(deps, f.actor, f.visitId, bad)).rejects.toThrow(DayError);
      }
      await addVoiceNote(deps, f.actor, f.visitId, {
        bytes: new Uint8Array([1]),
        contentType: "audio/mp4",
      });
      const [day] = await dayVisits(tx, f.tenantId, f.mechanicId, "2027-04-20");
      expect(day).toMatchObject({ voiceNotes: 1, photos: 0 });
      expect([...f.storage.objects.keys()][0]).toMatch(
        new RegExp(`^${f.tenantId}/visits/${f.visitId}/[0-9a-f-]{36}\\.m4a$`),
      );
    });
  });
});

describe("the picture of the boat on the day view", () => {
  it("is the boat's own latest picture, else the job's, never one from the work", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Bildfirman", "+46701119410");
      // The helper's picture is for the isolation test, with no file behind it.
      await tx.delete(attachment).where(eq(attachment.tenantId, f.tenantId));
      const deps = { db: tx, storage: f.storage };
      const picture = async (ownerType: string, ownerId: string, name: string, at: Date) => {
        const key = `${f.tenantId}/${ownerType}s/${ownerId}/${name}.jpg`;
        await f.storage.put(key, new TextEncoder().encode(name), "image/jpeg");
        await tx.insert(attachment).values({
          tenantId: f.tenantId,
          ownerType,
          ownerId,
          storageKey: key,
          contentType: "image/jpeg",
          sizeBytes: name.length,
          createdAt: at,
        });
      };
      const shown = async () => {
        const p = await visitBoatPicture(deps, f.actor, f.visitId);
        return p ? new TextDecoder().decode(p.bytes) : null;
      };
      const day = async () =>
        (await dayVisits(tx, f.tenantId, f.mechanicId, "2027-04-20"))[0]?.boatPicture;

      expect(await shown()).toBeNull();
      expect(await day()).toBe(false);
      // A picture from the work on the visit does not count.
      await picture("visit", f.visitId, "drevet", new Date("2027-04-20T07:00:00Z"));
      expect(await shown()).toBeNull();
      // The customer's picture from the booking, until the boat has one of its own.
      await picture("job", f.jobId, "kundens", new Date("2027-04-10T07:00:00Z"));
      expect(await shown()).toBe("kundens");
      await picture("boat", f.boatId, "gammal", new Date("2026-05-01T07:00:00Z"));
      await picture("boat", f.boatId, "ny", new Date("2027-01-01T07:00:00Z"));
      expect(await shown()).toBe("ny");
      expect(await day()).toBe(true);

      // Only for those who may work on the visit.
      const [other] = await tx
        .insert(appUser)
        .values({ tenantId: f.tenantId, name: "Annan", role: "mechanic" })
        .returning();
      await expect(
        visitBoatPicture(deps, { ...f.actor, userId: other!.id }, f.visitId),
      ).rejects.toMatchObject({ code: "forbidden" });
    });
  });
});
