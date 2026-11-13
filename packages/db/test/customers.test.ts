import { stockholmInstant } from "@bojen/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createBooking } from "../src/booking";
import { CARD_MESSAGES, PAGE_SIZE, customerCard, searchCustomers } from "../src/customers";
import {
  appUser,
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  customerSearch,
  drive,
  engine,
  location,
  message,
  serviceType,
  tenant,
  workSchedule,
} from "../src/schema";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const NOW = new Date("2026-11-16T12:00:00Z");

/** Two firms, each with customers, boats, engines, drives, marinas and a visit. */
async function setup(tx: Tx) {
  const [t] = await tx.insert(tenant).values({ name: "Kundfirman" }).returning();
  const [other] = await tx.insert(tenant).values({ name: "Annan firma" }).returning();
  const tenantId = t!.id;

  const [bullando, saltsjon] = await tx
    .insert(location)
    .values([
      { tenantId, type: "marina", name: "Bullandö Marina", position: { lng: 18.69, lat: 59.29 } },
      { tenantId, type: "marina", name: "Saltsjöbaden", position: { lng: 18.3, lat: 59.28 } },
    ])
    .returning();
  const [per, anna, marina] = await tx
    .insert(customer)
    .values([
      { tenantId, name: "Per Persson", phone: "+46701740601", email: "per@kund.test" },
      { tenantId, name: "Anna Ek", phone: "+46701740602" },
      { tenantId, name: "Bullandö Marina AB", type: "marina", phone: "+4686500400" },
      { tenantId, name: "Borttagen Kund", phone: "+46701740699", deletedAt: new Date() },
    ])
    .returning();
  const [bustern, vagen, sold] = await tx
    .insert(boat)
    .values([
      { tenantId, name: "Bustern", make: "Nimbus", model: "3000", registrationNumber: "SXK-4711" },
      { tenantId, name: "Vågen", make: "Targa", model: "28" },
      { tenantId, name: "Gamla", make: "Linjett", model: "34", status: "sold" },
    ])
    .returning();
  await tx.insert(boatOwnership).values([
    { tenantId, boatId: bustern!.id, customerId: per!.id, role: "owner" },
    { tenantId, boatId: vagen!.id, customerId: per!.id, role: "co_owner" },
    { tenantId, boatId: vagen!.id, customerId: anna!.id, role: "owner" },
    { tenantId, boatId: sold!.id, customerId: anna!.id, role: "owner" },
  ]);
  const [volvo] = await tx
    .insert(engine)
    .values([
      {
        tenantId,
        boatId: bustern!.id,
        make: "Volvo Penta",
        model: "D3-220",
        serialNumber: "VP-ENG-1234",
      },
      { tenantId, boatId: vagen!.id, make: "Yamaha", model: "F150", serialNumber: "YA-8800" },
    ])
    .returning();
  await tx.insert(drive).values({
    tenantId,
    engineId: volvo!.id,
    type: "DPH",
    serialNumber: "DRV-9090",
  });
  await tx.insert(boatPlacement).values([
    {
      tenantId,
      boatId: bustern!.id,
      locationId: bullando!.id,
      season: "winter",
      mode: "land",
      spotId: "B14",
      haulOutDate: "2026-10-15",
      launchDate: "2027-05-01",
    },
    {
      tenantId,
      boatId: vagen!.id,
      locationId: saltsjon!.id,
      season: "winter",
      mode: "land",
      haulOutDate: "2026-10-15",
      launchDate: "2027-05-01",
    },
  ]);

  // The other firm has a customer who would match every search below.
  const [stranger] = await tx
    .insert(customer)
    .values({ tenantId: other!.id, name: "Per Persson", phone: "+46701740601" })
    .returning();
  const [strangerBoat] = await tx
    .insert(boat)
    .values({ tenantId: other!.id, name: "Bustern", make: "Nimbus", model: "3000" })
    .returning();
  await tx
    .insert(boatOwnership)
    .values({ tenantId: other!.id, boatId: strangerBoat!.id, customerId: stranger!.id });

  return {
    tenantId,
    otherTenantId: other!.id,
    strangerId: stranger!.id,
    perId: per!.id,
    annaId: anna!.id,
    marinaId: marina!.id,
    bustern: bustern!.id,
  };
}

const names = async (tx: Tx, tenantId: string, query: string, page = 1) =>
  (await searchCustomers(tx, tenantId, query, { now: NOW, page })).rows.map((r) => r.name);

describe("customer search", () => {
  it("lists every customer alphabetically without a query, leaving out deleted ones", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      expect(await names(tx, f.tenantId, "")).toEqual([
        "Anna Ek",
        "Bullandö Marina AB",
        "Per Persson",
      ]);
    });
  });

  it("finds a customer by phone, however the number is typed or cut", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      for (const typed of [
        "0701740601",
        "070-174 06 01",
        "+46 70 174 06 01",
        "0046701740601",
        "174 06 01",
        "40601",
      ]) {
        expect(await names(tx, f.tenantId, typed), typed).toEqual(["Per Persson"]);
      }
      expect(await names(tx, f.tenantId, "070 174 06")).toEqual(["Anna Ek", "Per Persson"]);
      expect(await names(tx, f.tenantId, "0701740699")).toEqual([]);
    });
  });

  it("finds a customer by name, e-mail, boat, engine, drive, serial number and marina", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const finds: [string, string[]][] = [
        ["persson", ["Per Persson"]],
        ["ANNA", ["Anna Ek"]],
        ["kund.test", ["Per Persson"]],
        ["Bustern", ["Per Persson"]],
        ["nimbus", ["Per Persson"]],
        ["3000", ["Per Persson"]],
        ["SXK-4711", ["Per Persson"]],
        ["Volvo", ["Per Persson"]],
        ["d3-220", ["Per Persson"]],
        ["VP-ENG-1234", ["Per Persson"]],
        ["DPH", ["Per Persson"]],
        ["DRV-9090", ["Per Persson"]],
        ["F150", ["Anna Ek", "Per Persson"]],
        ["YA-8800", ["Anna Ek", "Per Persson"]],
        ["Saltsjöbaden", ["Anna Ek", "Per Persson"]],
        ["Bullandö", ["Bullandö Marina AB", "Per Persson"]],
      ];
      for (const [query, expected] of finds) {
        expect(await names(tx, f.tenantId, query), query).toEqual(expected);
      }
    });
  });

  it("needs every word to match, in any field", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      expect(await names(tx, f.tenantId, "Per Nimbus")).toEqual(["Per Persson"]);
      expect(await names(tx, f.tenantId, "Nimbus Volvo Bullandö")).toEqual(["Per Persson"]);
      expect(await names(tx, f.tenantId, "Per Yamaha")).toEqual(["Per Persson"]);
      expect(await names(tx, f.tenantId, "Anna Nimbus")).toEqual([]);
      expect(await names(tx, f.tenantId, "Nimbus 3000 SXK")).toEqual(["Per Persson"]);
    });
  });

  it("takes % and _ literally and finds nothing in what does not exist", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      expect(await names(tx, f.tenantId, "%")).toEqual([]);
      expect(await names(tx, f.tenantId, "_")).toEqual([]);
      expect(await names(tx, f.tenantId, "P_r")).toEqual([]);
      expect(await names(tx, f.tenantId, "Pe%on")).toEqual([]);
      expect(await names(tx, f.tenantId, "'; drop table customer; --")).toEqual([]);
      expect(await names(tx, f.tenantId, "Zzzz")).toEqual([]);
    });
  });

  it("never shows another firm's customers", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const one = await searchCustomers(tx, f.tenantId, "Per", { now: NOW });
      expect(one.rows.map((r) => r.id)).toEqual([f.perId]);
      const theirs = await searchCustomers(tx, f.otherTenantId, "Per", { now: NOW });
      expect(theirs.rows.map((r) => r.id)).toEqual([f.strangerId]);
      expect(await customerCard(tx, f.tenantId, f.strangerId, NOW)).toBeNull();
      expect(await customerCard(tx, f.otherTenantId, f.perId, NOW)).toBeNull();
    });
  });

  it("shows each customer's boats and where they are today", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const { rows } = await searchCustomers(tx, f.tenantId, "Per", { now: NOW });
      expect(rows[0]?.boats).toMatchObject([
        { name: "Bustern", make: "Nimbus", model: "3000", place: "Bullandö Marina" },
        { name: "Vågen", make: "Targa", model: "28", place: "Saltsjöbaden" },
      ]);
      // In the summer the winter place is not where the boat is.
      const summer = await searchCustomers(tx, f.tenantId, "Per", {
        now: new Date("2027-06-15T10:00:00Z"),
      });
      expect(summer.rows[0]?.boats.map((b) => b.place)).toEqual([null, null]);
    });
  });

  it("pages the list", async () => {
    await withRollback(async (tx) => {
      const [t] = await tx.insert(tenant).values({ name: "Stor firma" }).returning();
      await tx.insert(customer).values(
        Array.from({ length: PAGE_SIZE + 7 }, (_, i) => ({
          tenantId: t!.id,
          name: `Kund ${String(i).padStart(3, "0")}`,
        })),
      );
      const first = await searchCustomers(tx, t!.id, "", { now: NOW });
      expect(first.rows).toHaveLength(PAGE_SIZE);
      expect(first.hasMore).toBe(true);
      expect(first.rows[0]?.name).toBe("Kund 000");
      const second = await searchCustomers(tx, t!.id, "", { now: NOW, page: 2 });
      expect(second.rows).toHaveLength(7);
      expect(second.hasMore).toBe(false);
      expect(second.rows[0]?.name).toBe(`Kund ${String(PAGE_SIZE).padStart(3, "0")}`);
      // A page number that is nonsense is the first page.
      expect((await searchCustomers(tx, t!.id, "", { now: NOW, page: -3 })).rows[0]?.name).toBe(
        "Kund 000",
      );
    });
  });
});

describe("customer card", () => {
  it("shows the customer, boats, visits and the messages as a timeline, newest first", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const [mechanic] = await tx
        .insert(appUser)
        .values({ tenantId: f.tenantId, name: "Jonas Ek", role: "mechanic" })
        .returning();
      await tx.insert(workSchedule).values(
        [1, 2, 3, 4, 5].map((weekday) => ({
          tenantId: f.tenantId,
          userId: mechanic!.id,
          weekday,
          startTime: "07:00",
          endTime: "17:00",
        })),
      );
      const [service] = await tx
        .insert(serviceType)
        .values({ tenantId: f.tenantId, name: "Vinterkonservering", defaultDurationMinutes: 120 })
        .returning();
      const book = (key: string, start: Date) =>
        createBooking(
          { db: tx, now: () => new Date("2026-10-01T08:00:00Z") },
          {
            tenantId: f.tenantId,
            actor: { type: "staff", id: mechanic!.id },
            idempotencyKey: key,
          },
          {
            customerId: f.perId,
            boatId: f.bustern,
            serviceTypeId: service!.id,
            mechanicId: mechanic!.id,
            start,
            channel: "phone",
            needsApproval: false,
            partsMissing: false,
          },
        );
      await book("card-1", stockholmInstant("2026-11-18", "08:00"));
      await book("card-2", stockholmInstant("2026-11-25", "08:00"));

      const at = (iso: string) => new Date(iso);
      await tx.insert(message).values([
        {
          tenantId: f.tenantId,
          channel: "sms",
          direction: "outbound",
          template: "f1_confirmation",
          customerId: f.perId,
          toAddress: "+46701740601",
          body: "Hej Per! Bokat.",
          status: "sent",
          sentAt: at("2026-11-10T10:00:00Z"),
          createdAt: at("2026-11-10T09:59:00Z"),
        },
        {
          tenantId: f.tenantId,
          channel: "sms",
          direction: "inbound",
          customerId: f.perId,
          fromAddress: "+46701740601",
          body: "Ja",
          status: "received",
          intent: "yes",
          createdAt: at("2026-11-11T08:00:00Z"),
        },
        {
          tenantId: f.tenantId,
          channel: "email",
          direction: "outbound",
          template: "f1_confirmation",
          customerId: f.perId,
          toAddress: "per@kund.test",
          subject: "Bokningsbekräftelse",
          body: "Hej Per!",
          status: "sent",
          sentAt: at("2026-11-10T10:00:01Z"),
          createdAt: at("2026-11-10T10:00:00Z"),
        },
        {
          tenantId: f.tenantId,
          channel: "sms",
          direction: "outbound",
          customerId: f.annaId,
          toAddress: "+46701740602",
          body: "Hej Anna",
          status: "sent",
          createdAt: at("2026-11-12T10:00:00Z"),
        },
      ]);

      const card = await customerCard(tx, f.tenantId, f.perId, NOW);
      expect(card).toMatchObject({
        name: "Per Persson",
        phone: "+46701740601",
        email: "per@kund.test",
        language: "sv",
      });
      expect(card?.boats).toMatchObject([
        { name: "Bustern", role: "owner", place: "Bullandö Marina", mode: "land", spotId: "B14" },
        { name: "Vågen", role: "co_owner", place: "Saltsjöbaden" },
      ]);
      // Newest visit first.
      expect(card?.visits.map((v) => v.start.toISOString())).toEqual([
        stockholmInstant("2026-11-25", "08:00").toISOString(),
        stockholmInstant("2026-11-18", "08:00").toISOString(),
      ]);
      expect(card?.visits[0]).toMatchObject({
        status: "booked",
        service: "Vinterkonservering",
        boat: "Bustern",
        mechanic: "Jonas Ek",
      });
      // The timeline holds Per's messages only, newest first, by when they were sent.
      expect(card?.timeline.map((m) => [m.channel, m.direction, m.body])).toEqual([
        ["sms", "inbound", "Ja"],
        ["email", "outbound", "Hej Per!"],
        ["sms", "outbound", "Hej Per! Bokat."],
      ]);
      expect(card?.timeline[0]).toMatchObject({ intent: "yes" });
      expect(card?.timeline[1]).toMatchObject({ subject: "Bokningsbekräftelse" });
    });
  });

  it("keeps the timeline to the latest messages", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await tx.insert(message).values(
        Array.from({ length: CARD_MESSAGES + 5 }, (_, i) => ({
          tenantId: f.tenantId,
          channel: "sms" as const,
          direction: "outbound" as const,
          customerId: f.perId,
          toAddress: "+46701740601",
          body: `Meddelande ${String(i)}`,
          status: "sent" as const,
          createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
        })),
      );
      const card = await customerCard(tx, f.tenantId, f.perId, NOW);
      expect(card?.timeline).toHaveLength(CARD_MESSAGES);
      expect(card?.timeline[0]?.body).toBe(`Meddelande ${String(CARD_MESSAGES + 4)}`);
    });
  });

  it("returns nothing for a deleted or unknown customer", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const [gone] = await tx.execute<{ id: string }>(
        sql`select id from customer where tenant_id = ${f.tenantId} and deleted_at is not null`,
      );
      expect(await customerCard(tx, f.tenantId, gone!.id, NOW)).toBeNull();
      expect(
        await customerCard(tx, f.tenantId, "00000000-0000-4000-8000-000000000000", NOW),
      ).toBeNull();
    });
  });
});

describe("the searchable text follows the data", () => {
  const find = (tx: Tx, tenantId: string, query: string) => names(tx, tenantId, query);
  const documentOf = async (tx: Tx, customerId: string) =>
    (
      await tx
        .select({ document: customerSearch.document })
        .from(customerSearch)
        .where(eq(customerSearch.customerId, customerId))
    )[0]?.document;

  it("holds everything staff search for, and only this firm's", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const document = await documentOf(tx, f.perId);
      for (const part of [
        "Per Persson",
        "+46701740601",
        "per@kund.test",
        "Bustern",
        "Nimbus",
        "3000",
        "SXK-4711",
        "Volvo Penta",
        "D3-220",
        "VP-ENG-1234",
        "DPH",
        "DRV-9090",
        "Bullandö Marina",
        "Vågen",
        "Yamaha",
        "Saltsjöbaden",
      ]) {
        expect(document, part).toContain(part);
      }
      expect(document).not.toContain("Anna");
      // The sold boat is Anna's alone.
      expect(await documentOf(tx, f.annaId)).toContain("Linjett");
      expect(document).not.toContain("Linjett");
    });
  });

  it("follows a customer's name, phone number and e-mail", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await tx
        .update(customer)
        .set({ name: "Pelle Persson", phone: "+46709998877", email: "pelle@kund.test" })
        .where(eq(customer.id, f.perId));
      expect(await find(tx, f.tenantId, "Pelle")).toEqual(["Pelle Persson"]);
      expect(await find(tx, f.tenantId, "0709998877")).toEqual(["Pelle Persson"]);
      expect(await find(tx, f.tenantId, "pelle@kund")).toEqual(["Pelle Persson"]);
      expect(await find(tx, f.tenantId, "per@kund")).toEqual([]);
      expect(await find(tx, f.tenantId, "0701740601")).toEqual([]);
    });
  });

  it("follows a boat, its engines and drives, and the marina", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      await tx.update(boat).set({ name: "Ankaret", model: "3100" }).where(eq(boat.id, f.bustern));
      expect(await find(tx, f.tenantId, "Ankaret")).toEqual(["Per Persson"]);
      expect(await find(tx, f.tenantId, "3100")).toEqual(["Per Persson"]);
      expect(await find(tx, f.tenantId, "Bustern")).toEqual([]);

      await tx
        .update(engine)
        .set({ serialNumber: "NY-SERIE-77" })
        .where(eq(engine.boatId, f.bustern));
      expect(await find(tx, f.tenantId, "NY-SERIE-77")).toEqual(["Per Persson"]);
      expect(await find(tx, f.tenantId, "VP-ENG-1234")).toEqual([]);

      await tx.update(drive).set({ serialNumber: "DRV-0001" });
      expect(await find(tx, f.tenantId, "DRV-0001")).toEqual(["Per Persson"]);
      expect(await find(tx, f.tenantId, "DRV-9090")).toEqual([]);

      // A marina that is renamed changes every customer who has a boat there.
      await tx
        .update(location)
        .set({ name: "Bullandö Hamn" })
        .where(and(eq(location.tenantId, f.tenantId), eq(location.name, "Bullandö Marina")));
      expect(await find(tx, f.tenantId, "Hamn")).toEqual(["Per Persson"]);
      expect(await find(tx, f.tenantId, "Bullandö Marina")).toEqual(["Bullandö Marina AB"]);
    });
  });

  it("follows a new engine, a drive, a placement and a new boat", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const [second] = await tx
        .insert(engine)
        .values({ tenantId: f.tenantId, boatId: f.bustern, make: "Suzuki", serialNumber: "SZ-5" })
        .returning();
      expect(await find(tx, f.tenantId, "SZ-5")).toEqual(["Per Persson"]);
      await tx
        .insert(drive)
        .values({ tenantId: f.tenantId, engineId: second!.id, serialNumber: "SZ-DRIVE" });
      expect(await find(tx, f.tenantId, "SZ-DRIVE")).toEqual(["Per Persson"]);

      const [marina] = await tx
        .insert(location)
        .values({
          tenantId: f.tenantId,
          type: "marina",
          name: "Vaxholm Gästhamn",
          position: { lng: 18.35, lat: 59.4 },
        })
        .returning();
      await tx.insert(boatPlacement).values({
        tenantId: f.tenantId,
        boatId: f.bustern,
        locationId: marina!.id,
        season: "summer",
        mode: "water",
        launchDate: "2027-05-01",
        haulOutDate: "2027-10-15",
      });
      expect(await find(tx, f.tenantId, "Vaxholm")).toEqual(["Per Persson"]);

      const [fresh] = await tx
        .insert(boat)
        .values({ tenantId: f.tenantId, name: "Nyakvarie", make: "Bella" })
        .returning();
      expect(await find(tx, f.tenantId, "Nyakvarie")).toEqual([]);
      await tx
        .insert(boatOwnership)
        .values({ tenantId: f.tenantId, boatId: fresh!.id, customerId: f.annaId });
      expect(await find(tx, f.tenantId, "Nyakvarie")).toEqual(["Anna Ek"]);
      expect(await find(tx, f.tenantId, "Anna Bella")).toEqual(["Anna Ek"]);
    });
  });

  it("drops what is removed or soft-deleted", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      // An owner who sells: the boat is no longer found through the old owner.
      await tx
        .delete(boatOwnership)
        .where(and(eq(boatOwnership.boatId, f.bustern), eq(boatOwnership.customerId, f.perId)));
      expect(await find(tx, f.tenantId, "Bustern")).toEqual([]);
      expect(await find(tx, f.tenantId, "Per Nimbus")).toEqual([]);

      await tx
        .update(boatOwnership)
        .set({ deletedAt: new Date() })
        .where(and(eq(boatOwnership.customerId, f.annaId), eq(boatOwnership.boatId, f.bustern)));
      // Soft-deleted boats and engines are left out too.
      await tx.update(boat).set({ deletedAt: new Date() }).where(eq(boat.make, "Targa"));
      expect(await find(tx, f.tenantId, "Targa")).toEqual([]);
      expect(await find(tx, f.tenantId, "Yamaha")).toEqual([]);
      await tx.update(engine).set({ deletedAt: new Date() }).where(eq(engine.make, "Volvo Penta"));
      expect(await find(tx, f.tenantId, "Volvo")).toEqual([]);
      expect(await find(tx, f.tenantId, "DPH")).toEqual([]);
      // The customer is still found by name.
      expect(await find(tx, f.tenantId, "Per Persson")).toEqual(["Per Persson"]);
    });
  });

  it("removes the text with the customer", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      expect(await documentOf(tx, f.marinaId)).toContain("Bullandö Marina AB");
      await tx.delete(customer).where(eq(customer.id, f.marinaId));
      expect(await documentOf(tx, f.marinaId)).toBeUndefined();
    });
  });
});
