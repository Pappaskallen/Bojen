import { createFakeMaps, createFakeSms, createFakeStorage } from "@bojen/adapters";
import { addDays, stockholmInstant } from "@bojen/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createBooking } from "../src/booking";
import {
  attachment,
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  job,
  location,
  serviceType,
  appUser,
  tenant,
  visit,
  workSchedule,
} from "../src/schema";
import {
  customerBoats,
  findFirm,
  publicCatalog,
  publicSuggestions,
  requestCode,
  submitPublicBooking,
  verifyCode,
} from "../src/public-booking";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

// Monday 6 September 2027, 08:00 in Stockholm. Haul-out at Bullandö is Thursday 16 September.
const NOW = stockholmInstant("2027-09-06", "08:00");
const BULLANDO = { lng: 18.6486, lat: 59.2969 };

async function firm(tx: Tx) {
  const [t] = await tx
    .insert(tenant)
    .values({
      name: "Publika firman",
      slug: `publika-${crypto.randomUUID().slice(0, 8)}`,
      settings: {
        booking: { marinaDayDiscount: { kind: "waive_callout" }, calloutPriceOre: 69_500 },
        branding: { color: "#0a4d68" },
      },
    })
    .returning();
  const tenantId = t!.id;
  const [jonas] = await tx
    .insert(appUser)
    .values({ tenantId, name: "Jonas", role: "mechanic" })
    .returning();
  await tx.insert(workSchedule).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      tenantId,
      userId: jonas!.id,
      weekday,
      startTime: "07:00",
      endTime: "17:00",
    })),
  );
  const [bullando, djuro] = await tx
    .insert(location)
    .values([
      {
        tenantId,
        type: "marina",
        name: "Bullandö Marina",
        slug: "bullando-marina",
        position: BULLANDO,
      },
      { tenantId, type: "yard", name: "Djurö Båtvarv", position: { lng: 18.6964, lat: 59.3122 } },
      { tenantId, type: "private_dock", name: "Privat brygga", position: { lng: 18.6, lat: 59.3 } },
    ])
    .returning();
  const [layUp] = await tx
    .insert(serviceType)
    .values({
      tenantId,
      name: "Vinterkonservering",
      defaultDurationMinutes: 120,
      requiredMode: "land",
    })
    .returning();
  const [per] = await tx
    .insert(customer)
    .values({ tenantId, name: "Per", phone: "+46701740610" })
    .returning();
  const [perBoat] = await tx
    .insert(boat)
    .values({ tenantId, name: "Solvik", make: "Nimbus", model: "305 Coupé" })
    .returning();
  await tx.insert(boatOwnership).values({ tenantId, boatId: perBoat!.id, customerId: per!.id });
  await tx.insert(boatPlacement).values({
    tenantId,
    boatId: perBoat!.id,
    locationId: bullando!.id,
    season: "summer",
    mode: "water",
    launchDate: "2027-05-01",
    haulOutDate: "2027-09-16",
  });
  const f = (await findFirm(tx, t!.slug!))!;
  return {
    firm: f,
    tenantId,
    mechanicId: jonas!.id,
    bullando: bullando!.id,
    djuro: djuro!.id,
    layUp: layUp!.id,
    per: per!.id,
    perBoat: perBoat!.id,
  };
}

const deps = (tx: Tx) => ({
  db: tx,
  sms: createFakeSms(),
  maps: createFakeMaps(),
  storage: createFakeStorage(),
  now: () => NOW,
  randomInt: () => 4711,
});

describe("the firm behind the link", () => {
  it("is found by slug with its colour, and its catalogue hides private places", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      expect(f.firm).toMatchObject({ name: "Publika firman", color: "#0a4d68", logoUrl: null });
      expect(await findFirm(tx, "finns-inte")).toBeNull();
      const catalog = await publicCatalog(tx, f.tenantId);
      expect(catalog.services.map((s) => [s.name, s.requiredMode])).toEqual([
        ["Vinterkonservering", "land"],
      ]);
      expect(catalog.places.map((p) => p.name)).toEqual(["Bullandö Marina", "Djurö Båtvarv"]);
    });
  });
});

describe("sms codes", () => {
  it("sends a code to a known customer and signs them in once", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const d = deps(tx);
      await requestCode(d, f.firm, "070-174 06 10");
      expect(d.sms.lastTo("+46701740610")).toBe(
        "004711 är din kod för att boka hos Publika firman.",
      );

      expect(await verifyCode(d, f.tenantId, "0701740610", "000000")).toEqual({
        ok: false,
        reason: "wrong",
      });
      expect(await verifyCode(d, f.tenantId, "0701740610", "004711")).toEqual({
        ok: true,
        customerId: f.per,
      });
      expect(await verifyCode(d, f.tenantId, "0701740610", "004711")).toEqual({
        ok: false,
        reason: "used",
      });

      const boats = await customerBoats(tx, f.tenantId, f.per, "2027-09-06");
      expect(boats).toEqual([
        {
          id: f.perBoat,
          label: "Solvik – Nimbus 305 Coupé",
          locationId: f.bullando,
          mode: "water",
        },
      ]);
    });
  });

  it("answers the same for unknown numbers and stops after three codes an hour", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const d = deps(tx);
      await requestCode(d, f.firm, "070-174 06 99");
      expect(d.sms.sent).toHaveLength(0);
      for (let i = 0; i < 5; i++) await requestCode(d, f.firm, "0701740610");
      expect(d.sms.sent).toHaveLength(3);
      await expect(requestCode(d, f.firm, "08-123 456 78")).rejects.toMatchObject({
        detail: "phone",
      });
    });
  });

  it("lets a code expire", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await requestCode(deps(tx), f.firm, "0701740610");
      const later = { db: tx, now: () => new Date(NOW.getTime() + 11 * 60_000) };
      expect(await verifyCode(later, f.tenantId, "0701740610", "004711")).toEqual({
        ok: false,
        reason: "expired",
      });
    });
  });
});

describe("suggestions", () => {
  it("puts a Bullandö day first and nothing before haul-out", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      // Another customer's boat on land at Bullandö, booked on Tuesday 21 September.
      const [other] = await tx
        .insert(boat)
        .values({ tenantId: f.tenantId, name: "Granne" })
        .returning();
      await tx.insert(boatPlacement).values({
        tenantId: f.tenantId,
        boatId: other!.id,
        locationId: f.bullando,
        season: "winter",
        mode: "land",
        haulOutDate: "2027-09-01",
      });
      await createBooking(
        { db: tx, now: () => NOW },
        {
          tenantId: f.tenantId,
          actor: { type: "staff", id: f.mechanicId },
          idempotencyKey: "granne",
        },
        {
          customerId: f.per,
          boatId: other!.id,
          serviceTypeId: f.layUp,
          mechanicId: f.mechanicId,
          start: stockholmInstant("2027-09-21", "08:00"),
          channel: "phone",
          needsApproval: false,
          partsMissing: false,
        },
      );

      const result = await publicSuggestions(deps(tx), f.tenantId, {
        serviceTypeId: f.layUp,
        place: { locationId: f.bullando },
        mode: "water",
        changeDate: "2027-09-16",
      });
      expect(result[0]).toMatchObject({
        day: "2027-09-21",
        label: "08–12",
        marinaDay: true,
        discount: { kind: "waive_callout" },
      });
      expect(result.every((s) => s.day >= "2027-09-16")).toBe(true);
    });
  });

  it("works for an address that is only a point on the map", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const result = await publicSuggestions(deps(tx), f.tenantId, {
        serviceTypeId: f.layUp,
        place: { position: { lng: 18.62, lat: 59.31 } },
        mode: "land",
      });
      expect(result).toHaveLength(3);
      expect(result[0]?.day).toBe("2027-09-06");
    });
  });
});

describe("submitPublicBooking", () => {
  const start = stockholmInstant("2027-09-22", "08:00");

  it("creates a new customer, boat and place, books for approval and keeps the pictures", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const d = deps(tx);
      const input = {
        serviceTypeId: f.layUp,
        mechanicId: f.mechanicId,
        start,
        customer: { name: "Anna Ny", phone: "073-174 06 20", email: "anna@example.com" },
        boat: {
          name: "Bustern",
          make: "Buster",
          model: "Magnum",
          engineMake: "Yamaha",
          engineHours: 410,
        },
        place: { address: "Bryggvägen 12, Värmdö", position: { lng: 18.62, lat: 59.31 } },
        mode: "land" as const,
        notes: "Nyckeln ligger i boden.",
        photos: [{ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }],
      };
      const result = await submitPublicBooking(d, f.firm, "web-1", input);
      expect(result.visit.status).toBe("pending_approval");
      expect(result.photosSaved).toBe(1);

      const [c] = await tx
        .select()
        .from(customer)
        .where(and(eq(customer.tenantId, f.tenantId), eq(customer.phone, "+46731740620")));
      expect(c).toMatchObject({ name: "Anna Ny", acquisitionChannel: "web" });
      const [j] = await tx.select().from(job).where(eq(job.id, result.visit.jobId));
      expect(j).toMatchObject({
        customerId: c!.id,
        channel: "web",
        description: "Nyckeln ligger i boden.",
      });
      const [placement] = await tx
        .select()
        .from(boatPlacement)
        .where(eq(boatPlacement.boatId, j!.boatId!));
      expect(placement).toMatchObject({ mode: "land", season: "winter" });
      const [place] = await tx
        .select()
        .from(location)
        .where(eq(location.id, placement!.locationId));
      expect(place).toMatchObject({ type: "private_dock", name: "Bryggvägen 12, Värmdö" });
      const files = await tx.select().from(attachment).where(eq(attachment.ownerId, j!.id));
      expect(files).toHaveLength(1);
      expect(d.storage.objects.has(files[0]!.storageKey)).toBe(true);
      expect(files[0]!.storageKey.startsWith(`${f.tenantId}/jobs/${j!.id}/`)).toBe(true);

      // The same request again: the stored answer, nothing created twice.
      const again = await submitPublicBooking(d, f.firm, "web-1", input);
      expect(again).toMatchObject({ replayed: true, visit: result.visit, photosSaved: 0 });
      const visits = await tx.select().from(visit).where(eq(visit.tenantId, f.tenantId));
      expect(visits).toHaveLength(1);
    });
  });

  it("books for a signed-in customer and their own boat only", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const d = deps(tx);
      const base = {
        serviceTypeId: f.layUp,
        mechanicId: f.mechanicId,
        start,
        customer: { id: f.per },
        place: { locationId: f.bullando },
        mode: "land" as const,
      };
      const ok = await submitPublicBooking(d, f.firm, "per-1", {
        ...base,
        boat: { id: f.perBoat },
      });
      expect(ok.visit.status).toBe("pending_approval");

      const [stranger] = await tx
        .insert(boat)
        .values({ tenantId: f.tenantId, name: "Någon annans" })
        .returning();
      await expect(
        submitPublicBooking(d, f.firm, "per-2", {
          ...base,
          start: stockholmInstant("2027-09-23", "08:00"),
          boat: { id: stranger!.id },
        }),
      ).rejects.toMatchObject({ code: "not_found", detail: "boat" });
    });
  });

  it("asks a known number to sign in instead of creating a second customer", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await expect(
        submitPublicBooking(deps(tx), f.firm, "dup-1", {
          serviceTypeId: f.layUp,
          mechanicId: f.mechanicId,
          start,
          customer: { name: "Per igen", phone: "0701740610" },
          boat: { name: "Ny" },
          place: { locationId: f.bullando },
          mode: "land",
        }),
      ).rejects.toMatchObject({ code: "conflict", detail: "already_customer" });
    });
  });

  it("refuses files that are not pictures", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await expect(
        submitPublicBooking(deps(tx), f.firm, "pdf-1", {
          serviceTypeId: f.layUp,
          mechanicId: f.mechanicId,
          start: stockholmInstant(addDays("2027-09-22", 1), "08:00"),
          customer: { id: f.per },
          boat: { id: f.perBoat },
          place: { locationId: f.bullando },
          mode: "land",
          photos: [{ bytes: new Uint8Array([1]), contentType: "application/pdf" }],
        }),
      ).rejects.toMatchObject({ code: "invalid_input", detail: "photo type" });
    });
  });
});
