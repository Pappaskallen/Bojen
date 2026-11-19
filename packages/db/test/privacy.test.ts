import { createFakeStorage } from "@bojen/adapters";
import { exportDocument } from "@bojen/core/privacy";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  eraseCustomer,
  exportCustomer,
  firmAudioDays,
  runRetention,
  setFirmAudioDays,
} from "../src/privacy";
import {
  accessInfo,
  appUser,
  attachment,
  auditLog,
  boat,
  call,
  consent,
  customer,
  customerSearch,
  engine,
  engineHoursReading,
  job,
  message,
  smsOptOut,
  survey,
  task,
  tenant,
  verificationCode,
  visit,
  waitlistEntry,
} from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const NOW = new Date("2027-06-01T01:00:00Z");
const PHONE = "+46701230042";

async function firm(tx: Tx, name = "Raderingsfirman", phone = PHONE) {
  const f = await createTenantWithBoat(tx, name, phone);
  const storage = createFakeStorage();
  const deps = { db: tx, storage, now: () => NOW };
  return { ...f, storage, deps };
}

const one = async <T>(rows: Promise<T[]>) => (await rows)[0];

describe("erasing a customer (the right to erasure)", () => {
  it("removes what identifies the customer and keeps the boat's technical history", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      // A recording and a voicemail on the customer's call, and a free-text survey answer.
      const [c] = await tx.select().from(call).where(eq(call.customerId, f.customerId));
      await tx
        .update(call)
        .set({
          audioKey: `${f.tenantId}/calls/a.wav`,
          transcript: "Hej, koden är…",
          summary: "Vill boka",
        })
        .where(eq(call.id, c?.id ?? ""));
      await f.storage.put(`${f.tenantId}/calls/a.wav`, new Uint8Array([1]), "audio/wav");
      await tx.insert(attachment).values({
        tenantId: f.tenantId,
        ownerType: "call",
        ownerId: c?.id ?? "",
        storageKey: `${f.tenantId}/calls/vm.wav`,
        contentType: "audio/wav",
        sizeBytes: 1,
      });
      await f.storage.put(`${f.tenantId}/calls/vm.wav`, new Uint8Array([2]), "audio/wav");
      await f.storage.put(`${f.tenantId}/jobs/x/drev.jpg`, new Uint8Array([3]), "image/jpeg");
      await tx.update(survey).set({ comment: "Anna var nöjd" });

      const staff = await one(
        tx.select({ id: auditLog.userId }).from(auditLog).where(eq(auditLog.tenantId, f.tenantId)),
      );
      expect(await eraseCustomer(f.deps, f.tenantId, f.customerId, staff?.id ?? null)).toBe(true);

      const erased = await one(tx.select().from(customer).where(eq(customer.id, f.customerId)));
      expect(erased).toMatchObject({
        name: "Raderad kund",
        phone: null,
        email: null,
        billingAddress: null,
      });
      expect(erased?.deletedAt).not.toBeNull();
      const search = await one(
        tx
          .select({ d: customerSearch.document })
          .from(customerSearch)
          .where(eq(customerSearch.customerId, f.customerId)),
      );
      expect(search?.d ?? "").not.toContain("+4670123");

      expect(await tx.select().from(consent).where(eq(consent.customerId, f.customerId))).toEqual(
        [],
      );
      expect(
        await tx.select().from(waitlistEntry).where(eq(waitlistEntry.customerId, f.customerId)),
      ).toEqual([]);
      expect(
        await tx.select().from(verificationCode).where(eq(verificationCode.phone, PHONE)),
      ).toEqual([]);
      const m = await one(tx.select().from(message).where(eq(message.customerId, f.customerId)));
      expect(m).toMatchObject({ body: null, toAddress: null, fromAddress: null });
      expect(m?.status).toBeTruthy();
      const erasedCall = await one(
        tx
          .select()
          .from(call)
          .where(eq(call.id, c?.id ?? "")),
      );
      expect(erasedCall).toMatchObject({
        callerNumber: null,
        transcript: null,
        summary: null,
        audioKey: null,
      });
      expect(await tx.select().from(attachment).where(eq(attachment.ownerType, "call"))).toEqual(
        [],
      );
      expect([...f.storage.objects.keys()]).toEqual([`${f.tenantId}/jobs/x/drev.jpg`]);
      const t = await one(tx.select().from(task).where(eq(task.customerId, f.customerId)));
      expect(t).toMatchObject({ title: "Ärende om en raderad kund", note: null });
      expect(
        (await one(tx.select().from(survey).where(eq(survey.visitId, f.visitId))))?.comment,
      ).toBeNull();

      // The boat stays as a boat: no name, no registration, no codes; the engine and hours stay.
      const b = await one(tx.select().from(boat).where(eq(boat.id, f.boatId)));
      expect(b).toMatchObject({ name: null, registrationNumber: null });
      expect(await tx.select().from(accessInfo).where(eq(accessInfo.boatId, f.boatId))).toEqual([]);
      expect(await tx.select().from(engine).where(eq(engine.boatId, f.boatId))).toHaveLength(1);
      expect(
        await tx
          .select()
          .from(engineHoursReading)
          .where(eq(engineHoursReading.engineId, f.engineId)),
      ).toHaveLength(1);
      expect(await tx.select().from(job).where(eq(job.id, f.jobId))).toHaveLength(1);
      // STOPP is kept, as a hash.
      expect(
        await tx.select().from(smsOptOut).where(eq(smsOptOut.tenantId, f.tenantId)),
      ).toHaveLength(1);

      const logged = await one(
        tx
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.action, "customer.erased"))),
      );
      expect(logged).toMatchObject({ subjectId: f.customerId, userId: staff?.id ?? null });
      expect(JSON.stringify(logged?.details)).not.toContain("+4670");

      // Erased once; a second time there is nothing to erase.
      expect(await eraseCustomer(f.deps, f.tenantId, f.customerId, null)).toBe(false);
    });
  });

  it("keeps a boat's name and codes while another owner is left, and touches no other firm", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const other = await firm(tx, "Grannfirman", "+46701230043");
      const [partner] = await tx
        .insert(customer)
        .values({ tenantId: f.tenantId, name: "Delägaren", phone: "+46701230044" })
        .returning();
      const { boatOwnership } = await import("../src/schema");
      await tx.insert(boatOwnership).values({
        tenantId: f.tenantId,
        boatId: f.boatId,
        customerId: partner?.id ?? "",
        role: "co_owner",
      });

      // Another firm's customer id does not erase anything here.
      expect(await eraseCustomer(f.deps, f.tenantId, other.customerId, null)).toBe(false);
      expect(await eraseCustomer(f.deps, f.tenantId, f.customerId, null)).toBe(true);
      expect((await one(tx.select().from(boat).where(eq(boat.id, f.boatId))))?.name).toBe(
        "Raderingsfirman båt",
      );
      expect(
        await tx.select().from(accessInfo).where(eq(accessInfo.boatId, f.boatId)),
      ).toHaveLength(1);
      expect(
        (await one(tx.select().from(customer).where(eq(customer.id, other.customerId))))?.phone,
      ).toBe("+46701230043");
    });
  });
});

describe("exporting a customer (the right of access)", () => {
  it("gives the customer's data as JSON, but never the codes", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const data = await exportCustomer(tx, f.tenantId, f.customerId, NOW);
      expect(data?.customer).toMatchObject({ name: "Raderingsfirman kund", phone: PHONE });
      expect(data?.boats[0]).toMatchObject({
        name: "Raderingsfirman båt",
        hasAccessInformation: true,
      });
      expect(data?.boats[0]?.engines[0]?.hours[0]?.hours).toBe("412.5");
      expect(data?.boats[0]?.placements).toHaveLength(1);
      expect(data?.jobs[0]?.visits[0]?.survey?.score).toBe(5);
      expect(data?.messages.length).toBeGreaterThan(0);
      expect(data?.calls).toHaveLength(1);
      expect(data?.consents.length).toBeGreaterThan(0);
      const json = JSON.stringify(data);
      expect(json).not.toContain("not-a-real-ciphertext");
      expect(json).not.toContain("codeEncrypted");
      expect(data?.firm.name).toBe("Raderingsfirman");

      // The same data as a document: the visit's window as the driver gives it is read.
      if (!data) throw new Error("no export");
      const doc = exportDocument(data);
      const visit = doc.lines.find((l) => l.kind === "field" && l.label === "Besök");
      expect(visit?.kind === "field" && visit.value).toMatch(
        /^\d{4}-\d\d-\d\d \d\d:\d\d–(\d{4}-\d\d-\d\d )?\d\d:\d\d \(/,
      );
      expect(JSON.stringify(doc)).not.toContain("not-a-real-ciphertext");
      // No export for an unknown or erased customer.
      expect(
        await exportCustomer(tx, f.tenantId, "00000000-0000-4000-8000-000000000000", NOW),
      ).toBeNull();
      await eraseCustomer(f.deps, f.tenantId, f.customerId, null);
      expect(await exportCustomer(tx, f.tenantId, f.customerId, NOW)).toBeNull();
    });
  });
});

describe("the nightly clean-up (spec 10.3)", () => {
  const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  it("removes each kind of data after its time and nothing sooner", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const [c] = await tx.select().from(call).where(eq(call.customerId, f.customerId));
      const callId = c?.id ?? "";
      const key = (n: string) => `${f.tenantId}/calls/${n}.wav`;
      // Three calls: 31 days old (kept with 90 days), 91 days (audio goes), 25 months (text goes).
      await tx
        .update(call)
        .set({ startedAt: ago(31), audioKey: key("new"), transcript: "nytt" })
        .where(eq(call.id, callId));
      const [old] = await tx
        .insert(call)
        .values({
          tenantId: f.tenantId,
          customerId: f.customerId,
          callerNumber: PHONE,
          startedAt: ago(91),
          audioKey: key("old"),
          transcript: "gammalt",
        })
        .returning();
      const [ancient] = await tx
        .insert(call)
        .values({
          tenantId: f.tenantId,
          callerNumber: PHONE,
          startedAt: ago(800),
          transcript: "uråldrigt",
          summary: "Ville boka",
        })
        .returning();
      for (const n of ["new", "old"]) await f.storage.put(key(n), new Uint8Array([1]), "audio/wav");

      // A message 25 months old and one from last week; an audit entry 25 months old.
      const [oldMessage] = await tx
        .insert(message)
        .values({
          tenantId: f.tenantId,
          channel: "sms",
          direction: "outbound",
          customerId: f.customerId,
          toAddress: PHONE,
          body: "Gammalt sms",
          status: "delivered",
          createdAt: ago(760),
        })
        .returning();
      await tx.insert(auditLog).values({
        tenantId: f.tenantId,
        action: "access_code_viewed",
        subjectType: "visit",
        occurredAt: ago(760),
      });
      // Access information that ran out yesterday.
      await tx
        .update(accessInfo)
        .set({ validUntil: "2027-05-31" })
        .where(eq(accessInfo.boatId, f.boatId));
      // An inquiry from 13 months ago that never became work, and one from last month.
      const [oldInquiry] = await tx
        .insert(job)
        .values({
          tenantId: f.tenantId,
          customerId: f.customerId,
          pipelineStatus: "inquiry",
          description: "Ring om motorn",
          updatedAt: ago(400),
        })
        .returning();
      const [newInquiry] = await tx
        .insert(job)
        .values({
          tenantId: f.tenantId,
          customerId: f.customerId,
          pipelineStatus: "inquiry",
          description: "Ny fråga",
          updatedAt: ago(30),
        })
        .returning();

      const report = await runRetention(f.deps);
      expect(report).toMatchObject({
        audio: 1,
        callTexts: 1,
        accessInfo: 1,
        inquiries: 1,
        customers: 0,
      });
      expect(report.messages).toBeGreaterThanOrEqual(1);
      expect(report.auditEntries).toBeGreaterThanOrEqual(1);

      expect([...f.storage.objects.keys()]).toEqual([key("new")]);
      expect((await one(tx.select().from(call).where(eq(call.id, callId))))?.audioKey).toBe(
        key("new"),
      );
      const oldCall = await one(
        tx
          .select()
          .from(call)
          .where(eq(call.id, old?.id ?? "")),
      );
      expect(oldCall).toMatchObject({ audioKey: null, transcript: "gammalt" });
      const ancientCall = await one(
        tx
          .select()
          .from(call)
          .where(eq(call.id, ancient?.id ?? "")),
      );
      expect(ancientCall).toMatchObject({ transcript: null, summary: null, callerNumber: null });

      const m = await one(
        tx
          .select()
          .from(message)
          .where(eq(message.id, oldMessage?.id ?? "")),
      );
      expect(m).toMatchObject({ body: null, toAddress: null, status: "delivered", channel: "sms" });
      const recent = await tx
        .select()
        .from(message)
        .where(and(eq(message.customerId, f.customerId), eq(message.status, "sent")));
      expect(recent.every((r) => r.body !== null || r.toAddress !== null)).toBe(true);

      expect(await tx.select().from(accessInfo).where(eq(accessInfo.boatId, f.boatId))).toEqual([]);
      expect(
        (
          await one(
            tx
              .select()
              .from(job)
              .where(eq(job.id, oldInquiry?.id ?? "")),
          )
        )?.deletedAt,
      ).not.toBeNull();
      expect(
        (
          await one(
            tx
              .select()
              .from(job)
              .where(eq(job.id, newInquiry?.id ?? "")),
          )
        )?.deletedAt,
      ).toBeNull();
      expect(
        (await one(tx.select().from(customer).where(eq(customer.id, f.customerId))))?.deletedAt,
      ).toBeNull();
    });
  });

  it("keeps audio 30 days when the firm chose it", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await tx
        .update(tenant)
        .set({ settings: { privacy: { audioDays: 30 } } })
        .where(eq(tenant.id, f.tenantId));
      await tx
        .update(call)
        .set({ startedAt: ago(31), audioKey: "k/31.wav" })
        .where(eq(call.customerId, f.customerId));
      const report = await runRetention(f.deps);
      expect(report.audio).toBe(1);
    });
  });

  it("anonymises a customer 36 months after the last job, not before", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const idle = await firm(tx, "Gamla firman", "+46701230045");
      // The idle firm's customer: created 4 years ago, the only job and visit 37 months ago.
      const longAgo = new Date("2024-04-20T06:00:00Z");
      await tx
        .update(customer)
        .set({ createdAt: new Date("2023-01-01T00:00:00Z") })
        .where(eq(customer.id, idle.customerId));
      await tx.update(job).set({ createdAt: longAgo }).where(eq(job.id, idle.jobId));
      await tx
        .update(visit)
        .set({
          timeWindow: `[${longAgo.toISOString()},${new Date(longAgo.getTime() + 7_200_000).toISOString()})`,
        })
        .where(eq(visit.id, idle.visitId));
      // The other firm's customer is just as old but has a visit ahead (the helper's, in 2027).
      await tx
        .update(customer)
        .set({ createdAt: new Date("2023-01-01T00:00:00Z") })
        .where(eq(customer.id, f.customerId));
      await tx.update(job).set({ createdAt: longAgo }).where(eq(job.id, f.jobId));

      const report = await runRetention(f.deps);
      expect(report.customers).toBe(1);
      expect(
        (await one(tx.select().from(customer).where(eq(customer.id, idle.customerId))))?.name,
      ).toBe("Raderad kund");
      expect(
        (await one(tx.select().from(customer).where(eq(customer.id, f.customerId))))?.name,
      ).toBe("Raderingsfirman kund");
    });
  });
});

describe("the firm's choice of audio retention (spec 10.5)", () => {
  it("is 90 days until the firm chooses 30, keeps the other settings and is logged", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await tx
        .update(tenant)
        .set({ settings: { reviewUrl: "https://g.page/x", privacy: { other: true } } })
        .where(eq(tenant.id, f.tenantId));
      expect(await firmAudioDays(tx, f.tenantId)).toBe(90);

      const user = await one(
        tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.tenantId, f.tenantId)),
      );
      await setFirmAudioDays(tx, f.tenantId, 30, user?.id ?? "", NOW);
      expect(await firmAudioDays(tx, f.tenantId)).toBe(30);
      const row = await one(
        tx.select({ settings: tenant.settings }).from(tenant).where(eq(tenant.id, f.tenantId)),
      );
      expect(row?.settings).toEqual({
        reviewUrl: "https://g.page/x",
        privacy: { other: true, audioDays: 30 },
      });
      const logged = await one(
        tx
          .select()
          .from(auditLog)
          .where(
            and(eq(auditLog.tenantId, f.tenantId), eq(auditLog.action, "settings.audio_days")),
          ),
      );
      expect(logged).toMatchObject({ userId: user?.id, details: { audioDays: 30 } });

      // It can be changed back, and only to 30 or 90.
      await setFirmAudioDays(tx, f.tenantId, 90, user?.id ?? "", NOW);
      expect(await firmAudioDays(tx, f.tenantId)).toBe(90);
      await expect(setFirmAudioDays(tx, f.tenantId, 45, user?.id ?? "", NOW)).rejects.toThrow(
        /audio choice/,
      );
    });
  });
});
