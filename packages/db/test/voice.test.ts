import { randomBytes } from "node:crypto";
import {
  createFakeGeocoder,
  createFakeMaps,
  createFakeStorage,
  createLocalKms,
} from "@bojen/adapters";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { encryptAccess } from "../src/access";
import { BookingError } from "../src/booking";
import { addPicturesByLink, createShortLink } from "../src/short-links";
import {
  avbokaBokning,
  avslutaSamtal,
  bekraftaKund,
  callContext,
  foreslaTider,
  hamtaBokningar,
  hittaKund,
  kopplaTillMekaniker,
  ombokaBokning,
  openCall,
  receptionistFacts,
  sattVantelista,
  skapaBokning,
  skapaMeddelande,
  skickaLank,
  startCall,
  stoppaInspelning,
  type VoiceDeps,
} from "../src/voice";
import {
  attachment,
  call,
  customer,
  job,
  location,
  locationAccessRule,
  locationContact,
  message,
  serviceType,
  task,
  tenant,
  visit,
  waitlistEntry,
} from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

/**
 * Contract tests for the receptionist's tools (byggplan step 6.1): what each takes and what
 * it answers, against the local database. The helper's firm has a booked visit on Monday
 * 20 April 2027 at its marina, and works Mondays 07–17.
 */
const NOW = new Date("2027-04-01T08:00:00Z");
const FIRM = "+46766860011";
const SECRET_ADDRESS = "Hemliga vägen 12";
const CODE = "GRIND-4711";
const KEY = "Under fendern vid masten";
const GATE = "8899#";

async function setUp(tx: Tx, name: string, phone: string) {
  const f = await createTenantWithBoat(tx, name, phone);
  await tx
    .update(tenant)
    .set({ settings: { sms: { from: FIRM } } })
    .where(eq(tenant.id, f.tenantId));
  // Everything the tools must never say: the boat's code and key, the marina's address,
  // gate code and key box.
  const kms = createLocalKms(randomBytes(32));
  await encryptAccess(
    { db: tx, kms, now: () => NOW },
    {
      tenantId: f.tenantId,
      boatId: f.boatId,
      code: CODE,
      keyLocation: KEY,
    },
  );
  await tx.update(location).set({ address: SECRET_ADDRESS }).where(eq(location.id, f.locationId));
  await tx
    .update(locationAccessRule)
    .set({ gateCodeEncrypted: Buffer.from(GATE), keyBoxEncrypted: Buffer.from(KEY) })
    .where(eq(locationAccessRule.locationId, f.locationId));
  const [st] = await tx.select().from(serviceType).where(eq(serviceType.tenantId, f.tenantId));
  const deps: VoiceDeps = {
    db: tx,
    now: () => NOW,
    optOutKey: "voice-test-opt-out-key-long-enough-1",
    maps: createFakeMaps(),
    geocoder: createFakeGeocoder(),
    storage: createFakeStorage(),
    linkKey: "voice-test-short-link-key-long-enough",
    secret: "voice-test-secret-long-enough-0123456789",
    appBase: "bojen.app",
  };
  const begin = async (from: string | null) => {
    const started = await startCall(tx, { to: FIRM, from, now: NOW });
    if (!started) throw new Error("No call");
    return started.callId;
  };
  const current = async (callId: string) => {
    const c = await openCall(tx, f.tenantId, callId);
    if (!c) throw new Error("The call has ended");
    return c;
  };
  return { ...f, deps, begin, current, serviceTypeId: st!.id };
}

const neverSecret = (answer: unknown) => {
  const json = JSON.stringify(answer);
  for (const secret of [
    SECRET_ADDRESS,
    CODE,
    KEY,
    GATE,
    "Grusplanen",
    "codeEncrypted",
    "address",
  ]) {
    expect(json).not.toContain(secret);
  }
};

describe("hitta_kund and the call's context", () => {
  it("never return access information or addresses, for a known caller or by number", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Kontextfirman", "+46701119601");
      const callId = await f.begin("070-111 96 01");
      const context = await callContext(f.deps, await f.current(callId));
      expect(context).toMatchObject({
        kand: true,
        kund: { id: f.customerId, fornamn: "Kontextfirman" },
        batar: [
          { id: f.boatId, namn: "Kontextfirman båt", plats: { namn: "Kontextfirman marina" } },
        ],
        kommande_besok: [{ id: f.visitId, dag: "2027-04-20", fonster: "08–12" }],
      });
      neverSecret(context);
      neverSecret(await hittaKund(f.deps, await f.current(callId), { telefon: "+46701119601" }));
      // Even when the model asks for more than it may have.
      neverSecret(
        await hittaKund(f.deps, await f.current(callId), {
          telefon: "+46701119601",
          kod: true,
          adress: true,
        }),
      );
    });
  });

  it("by another number gives only the first name until the control question", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Doldfirman", "+46701119602");
      const callId = await f.begin(null);
      expect(await callContext(f.deps, await f.current(callId))).toEqual({ kand: false });
      const found = await hittaKund(f.deps, await f.current(callId), { telefon: "0701119602" });
      expect(found).toEqual({
        kand: true,
        kund: { id: f.customerId, fornamn: "Doldfirman" },
        kontroll_kravs: true,
      });
      expect(await hamtaBokningar(f.deps, await f.current(callId))).toEqual({
        fel: "kontroll_kravs",
      });
      expect(await hittaKund(f.deps, await f.current(callId), { telefon: "+46709999999" })).toEqual(
        {
          kand: false,
        },
      );
      expect(await hittaKund(f.deps, await f.current(callId), { telefon: "hej" })).toEqual({
        fel: "ogiltigt_nummer",
      });
    });
  });

  it("knows a marina's contact person as a business caller", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Marinafirman", "+46701119603");
      // The helper's marina contact has the customer's number; give them their own.
      await tx
        .update(locationContact)
        .set({ phone: "+46701119699", name: "Lena Strand" })
        .where(eq(locationContact.locationId, f.locationId));
      const callId = await f.begin("+46701119699");
      expect(await callContext(f.deps, await f.current(callId))).toEqual({
        kand: false,
        marinakontakt: { fornamn: "Lena", plats: "Marinafirman marina" },
      });
    });
  });

  it("is only for a firm's own number", async () => {
    await withRollback(async (tx) => {
      expect(
        await startCall(tx, { to: "+46700000000", from: "+46701119604", now: NOW }),
      ).toBeNull();
    });
  });
});

describe("bekrafta_kund", () => {
  it("proves the caller with the boat's name or marina, and closes after three wrong tries", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Kontrollfirman", "+46701119605");
      const callId = await f.begin(null);
      await hittaKund(f.deps, await f.current(callId), { telefon: "+46701119605" });
      expect(await bekraftaKund(f.deps, await f.current(callId), { svar: "en Volvo" })).toEqual({
        bekraftad: false,
        forsok_kvar: 2,
      });
      const proven = await bekraftaKund(f.deps, await f.current(callId), {
        svar: "den ligger på kontrollfirman marina",
      });
      expect(proven).toMatchObject({
        bekraftad: true,
        kund: { id: f.customerId },
        batar: [{ id: f.boatId }],
      });
      neverSecret(proven);
      expect(await hamtaBokningar(f.deps, await f.current(callId))).toMatchObject({
        besok: [{ id: f.visitId }],
      });

      const other = await f.begin(null);
      await hittaKund(f.deps, await f.current(other), { telefon: "+46701119605" });
      for (let i = 0; i < 3; i++)
        await bekraftaKund(f.deps, await f.current(other), { svar: "fel" });
      expect(
        await bekraftaKund(f.deps, await f.current(other), { svar: "Kontrollfirman båt" }),
      ).toEqual({
        fel: "for_manga_forsok",
      });
    });
  });
});

describe("foresla_tider and skapa_bokning", () => {
  it("offer times only this call can book, and book them once for a known customer", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Bokningsfirman", "+46701119606");
      const callId = await f.begin("+46701119606");
      const offered = await foreslaTider(f.deps, await f.current(callId), {
        tjanst_id: f.serviceTypeId,
        plats_id: f.locationId,
        lage: "water",
      });
      if (!("tider" in offered)) throw new Error(JSON.stringify(offered));
      expect(offered.tider.length).toBeGreaterThan(0);
      expect(offered.tider[0]).toMatchObject({
        dag: expect.stringMatching(/^2027-/),
        marinadag: expect.any(Boolean),
      });
      neverSecret(offered);
      const tid = offered.tider[0]!.tid_id;

      const booked = await skapaBokning(f.deps, await f.current(callId), {
        tid_id: tid,
        bat_id: f.boatId,
        beskrivning: "Motorn startar inte",
        bradskande: "soon",
      });
      expect(booked).toMatchObject({ besok_id: expect.any(String), status: expect.any(String) });
      // The same booking again (a retry) is the same visit.
      expect(
        await skapaBokning(f.deps, await f.current(callId), {
          tid_id: tid,
          bat_id: f.boatId,
          beskrivning: "Motorn startar inte",
          bradskande: "soon",
        }),
      ).toEqual(booked);
      const [made] = await tx
        .select({ channel: job.channel, urgency: job.urgency, description: job.description })
        .from(job)
        .innerJoin(visit, eq(visit.jobId, job.id))
        .where(eq(visit.id, (booked as { besok_id: string }).besok_id));
      expect(made).toEqual({
        channel: "phone",
        urgency: "soon",
        description: "Motorn startar inte",
      });
      expect((await f.current(callId)).jobId).not.toBeNull();

      // A time from another call, or a changed one, cannot be booked.
      const other = await f.begin("+46701119606");
      expect(
        await skapaBokning(f.deps, await f.current(other), { tid_id: tid, beskrivning: "x" }),
      ).toEqual({ fel: "okand_tid" });
      expect(
        await skapaBokning(f.deps, await f.current(callId), {
          tid_id: `${tid}x`,
          beskrivning: "x",
        }),
      ).toEqual({ fel: "okand_tid" });
      expect(
        await foreslaTider(f.deps, await f.current(callId), {
          tjanst_id: f.serviceTypeId,
          lage: "water",
        }),
      ).toEqual({ fel: "okand_plats" });
    });
  });

  it("make a new customer from the caller's name and number, at a marina named by the caller", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Nyfirman", "+46701119607");
      const callId = await f.begin("+46701119677");
      const offered = await foreslaTider(f.deps, await f.current(callId), {
        tjanst_id: f.serviceTypeId,
        plats_namn: "nyfirman marina",
        lage: "land",
      });
      if (!("tider" in offered)) throw new Error(JSON.stringify(offered));
      const tid = offered.tider[0]!.tid_id;
      expect(
        await skapaBokning(f.deps, await f.current(callId), {
          tid_id: tid,
          beskrivning: "Service",
        }),
      ).toEqual({
        fel: "namn_saknas",
      });
      const booked = await skapaBokning(f.deps, await f.current(callId), {
        tid_id: tid,
        namn: "Ny Kund",
        bat_marke: "Buster",
        bat_modell: "M",
        beskrivning: "Service",
      });
      expect(booked).toMatchObject({ besok_id: expect.any(String) });
      const [created] = await tx
        .select({ name: customer.name, channel: customer.acquisitionChannel })
        .from(customer)
        .where(and(eq(customer.tenantId, f.tenantId), eq(customer.phone, "+46701119677")));
      expect(created).toEqual({ name: "Ny Kund", channel: "phone" });
      // The call knows the customer now.
      expect((await f.current(callId)).customerId).not.toBeNull();
    });
  });
});

describe("omboka_bokning and avboka_bokning", () => {
  it("need the control question, and only touch the proven customer's visits", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Ändrafirman", "+46701119608");
      const callId = await f.begin("+46701119608");
      // The call's number is not proof: the shown number can be faked.
      expect(await avbokaBokning(f.deps, await f.current(callId), { besok_id: f.visitId })).toEqual(
        {
          fel: "kontroll_kravs",
        },
      );
      await bekraftaKund(f.deps, await f.current(callId), { svar: "Ändrafirman båt" });
      const offered = await foreslaTider(f.deps, await f.current(callId), {
        tjanst_id: f.serviceTypeId,
        plats_id: f.locationId,
        lage: "water",
        tidigast: "2027-04-26",
      });
      if (!("tider" in offered)) throw new Error(JSON.stringify(offered));
      const moved = await ombokaBokning(f.deps, await f.current(callId), {
        besok_id: f.visitId,
        tid_id: offered.tider[0]!.tid_id,
      });
      expect(moved).toMatchObject({ besok_id: f.visitId, status: "booked" });
      expect(
        await avbokaBokning(f.deps, await f.current(callId), { besok_id: f.visitId }),
      ).toMatchObject({
        status: "cancelled",
      });

      // Another firm's or another customer's visit is not found.
      const g = await createTenantWithBoat(tx, "Annanfirman", "+46701119609");
      expect(await avbokaBokning(f.deps, await f.current(callId), { besok_id: g.visitId })).toEqual(
        {
          fel: "okant_besok",
        },
      );
    });
  });
});

describe("skicka_lank", () => {
  it("sends the booking's own link to the call's number, never to another", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Länkfirman", "+46701119610");
      const callId = await f.begin("+46701119610");
      for (const typ of ["atkomst", "bokning", "bilder", "typskylt"]) {
        expect(
          await skickaLank(f.deps, await f.current(callId), { typ, telefon: "+46709999999" }),
        ).toEqual({
          ok: true,
        });
      }
      const sent = await tx
        .select({ to: message.toAddress, template: message.template, body: message.body })
        .from(message)
        .where(
          and(
            eq(message.tenantId, f.tenantId),
            sql`${message.template} in ('voice_access_link', 'voice_booking_link', 'voice_pictures_link', 'f15_type_plate')`,
          ),
        );
      expect(sent.map((s) => s.template).sort()).toEqual([
        "f15_type_plate",
        "voice_access_link",
        "voice_booking_link",
        "voice_pictures_link",
      ]);
      expect(
        sent.every((s) => s.to === "+46701119610" && /bojen.app\/x\//.test(s.body ?? "")),
      ).toBe(true);
      neverSecret(sent.map((s) => s.body));
      expect(await skickaLank(f.deps, await f.current(callId), { typ: "kod" })).toEqual({
        fel: "okand_typ",
      });
    });
  });
});

describe("the other tools", () => {
  it("put the caller on the waitlist, take a message, stop the recording and end the call", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Övrigafirman", "+46701119611");
      const callId = await f.begin("+46701119611");
      expect(
        await sattVantelista(f.deps, await f.current(callId), {
          tjanst_id: f.serviceTypeId,
          fran: "2027-05-01",
          till: "2027-05-31",
        }),
      ).toMatchObject({ ok: true });
      const [entry] = await tx
        .select({ earliest: waitlistEntry.earliestDate, customerId: waitlistEntry.customerId })
        .from(waitlistEntry)
        .where(
          and(eq(waitlistEntry.tenantId, f.tenantId), eq(waitlistEntry.earliestDate, "2027-05-01")),
        );
      expect(entry?.customerId).toBe(f.customerId);

      expect(
        await kopplaTillMekaniker(f.deps, await f.current(callId), {
          anledning: "manniska",
          skal: "Vill prata med Jonas",
        }),
      ).toEqual({ status: "ta_meddelande", svarslofte: "nästa vardag före klockan tio" });
      const message = await skapaMeddelande(f.deps, await f.current(callId), {
        skal: "reklamation",
        text: "Läcker fortfarande efter förra besöket.",
      });
      const [t] = await tx
        .select({ title: task.title, priority: task.priority, callId: task.callId })
        .from(task)
        .where(eq(task.id, (message as { arende_id: string }).arende_id));
      expect(t).toEqual({
        title: "Reklamation: Övrigafirman kund ringde",
        priority: "high",
        callId,
      });

      expect(await stoppaInspelning(f.deps, await f.current(callId))).toEqual({ ok: true });
      expect((await f.current(callId)).recordingAllowed).toBe(false);
      expect(
        await avslutaSamtal(f.deps, await f.current(callId), {
          sammanfattning: "Reklamation, ring upp.",
          utfall: "message",
          arende: "annat",
        }),
      ).toEqual({ ok: true });
      // Ended: the call's token leads nowhere any more.
      expect(await openCall(tx, f.tenantId, callId)).toBeNull();
      const [ended] = await tx
        .select({ outcome: call.outcome, summary: call.summary, intent: call.intent })
        .from(call)
        .where(eq(call.id, callId));
      expect(ended?.outcome).toBe("message");
      // What the caller wanted, for KPI 22 (step 7.3).
      expect(ended?.intent).toBe("other");
      expect(ended?.summary).toContain("Ville kopplas: Vill prata med Jonas");
      expect(ended?.summary).toContain("Reklamation, ring upp.");
    });
  });
});

describe("the pictures link", () => {
  it("takes up to five pictures onto the visit's job, and nothing else", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Bildlänkfirman", "+46701119612");
      const code = await createShortLink(tx, f.deps.linkKey, {
        tenantId: f.tenantId,
        visitId: f.visitId,
        purpose: "manage",
        expiresAt: new Date("2027-04-20T06:00:00Z"),
      });
      const deps = { db: tx, now: () => NOW, linkKey: f.deps.linkKey, storage: f.deps.storage };
      const png = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" };
      expect(await addPicturesByLink(deps, code, [png, png])).toBe(2);
      const saved = await tx
        .select({ ownerType: attachment.ownerType, key: attachment.storageKey })
        .from(attachment)
        .where(and(eq(attachment.ownerId, f.jobId), eq(attachment.contentType, "image/png")));
      expect(saved).toHaveLength(2);
      expect(
        saved.every(
          (s) => s.ownerType === "job" && s.key.startsWith(`${f.tenantId}/jobs/${f.jobId}/`),
        ),
      ).toBe(true);
      for (const bad of [
        [],
        Array.from({ length: 6 }, () => png),
        [{ bytes: new Uint8Array([1]), contentType: "text/html" }],
      ]) {
        await expect(addPicturesByLink(deps, code, bad)).rejects.toThrow(BookingError);
      }
      await expect(addPicturesByLink(deps, "fel-kod", [png])).rejects.toThrow(BookingError);
    });
  });
});

describe("the firm's facts for the prompt", () => {
  it("are the services, places, prices and settings, without any address", async () => {
    await withRollback(async (tx) => {
      const f = await setUp(tx, "Faktafirman", "+46701119613");
      await tx
        .update(tenant)
        .set({
          settings: {
            sms: { from: FIRM },
            booking: { hourlyRateOre: 95_000, emergencySurchargeOre: 180_000 },
            receptionist: { assistantName: "Saga", notServed: ["Arholma"] },
          },
        })
        .where(eq(tenant.id, f.tenantId));
      const facts = await receptionistFacts(tx, f.tenantId);
      expect(facts).toMatchObject({
        firma: "Faktafirman",
        assistentNamn: "Saga",
        mekaniker: "Faktafirman",
        ejServiceomraden: ["Arholma"],
        timpris: 950,
        akuttillagg: 1800,
        tjanster: [{ id: f.serviceTypeId, namn: "Vårservice", minuter: 120 }],
        platser: expect.arrayContaining([
          { id: f.locationId, namn: "Faktafirman marina", typ: "marina" },
        ]),
      });
      neverSecret(facts);
      expect(await receptionistFacts(tx, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
});
