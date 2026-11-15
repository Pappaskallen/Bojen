import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { createLocalKms } from "@bojen/adapters";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { encryptLocationAccess } from "../src/access";
import { listPlaces, placeCard } from "../src/places";
import {
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  location,
  locationContact,
  tenant,
} from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const WINTER = new Date("2026-12-01T10:00:00Z");
const SUMMER = new Date("2026-06-15T10:00:00Z");

/** The helper's firm, its marina with a second boat on land, and a private dock. */
async function firm(tx: Tx) {
  const f = await createTenantWithBoat(tx, "Marinafirman", "+46701119101");
  await tx.update(tenant).set({ slug: "marinafirman" }).where(eq(tenant.id, f.tenantId));
  await tx
    .update(location)
    .set({ slug: "hamnen", address: "Hamnvägen 1" })
    .where(eq(location.id, f.locationId));
  const [club] = await tx
    .insert(customer)
    .values({ tenantId: f.tenantId, name: "Hamnens Båtklubb", type: "club" })
    .returning();
  await tx.update(location).set({ ownerCustomerId: club!.id }).where(eq(location.id, f.locationId));

  const [second] = await tx
    .insert(boat)
    .values({ tenantId: f.tenantId, name: "Andra båten", make: "Linjett", model: "34" })
    .returning();
  const [owner] = await tx
    .insert(customer)
    .values({ tenantId: f.tenantId, name: "Ägare Två", phone: "+46701119102" })
    .returning();
  await tx
    .insert(boatOwnership)
    .values({ tenantId: f.tenantId, boatId: second!.id, customerId: owner!.id });
  await tx.insert(boatPlacement).values({
    tenantId: f.tenantId,
    boatId: second!.id,
    locationId: f.locationId,
    season: "winter",
    mode: "land",
    spotId: "C3",
    haulOutDate: "2026-10-15",
    launchDate: "2027-05-01",
  });
  await tx.insert(locationContact).values({
    tenantId: f.tenantId,
    locationId: f.locationId,
    name: "Kontoret",
    role: "Reception",
    email: "kontor@hamnen.test",
  });
  await tx.insert(location).values({
    tenantId: f.tenantId,
    type: "private_dock",
    name: "Egen brygga",
    position: { lng: 18.7, lat: 59.3 },
  });
  return { ...f, clubId: club!.id, secondId: second!.id, ownerTwoId: owner!.id };
}

describe("marina list", () => {
  it("lists marinas, clubs and yards with the boats there now, not private docks", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const rows = await listPlaces(tx, f.tenantId, WINTER);
      expect(rows.map((r) => [r.name, r.type, r.boatsNow])).toEqual([
        ["Marinafirman marina", "marina", 1],
        ["Marinafirman varv", "yard", 0],
      ]);
      // In the summer the helper's boat is back at the marina, the other one is in its winter
      // place only.
      const summer = await listPlaces(tx, f.tenantId, SUMMER);
      expect(summer[0]?.boatsNow).toBe(1);
    });
  });
});

describe("marina card", () => {
  it("shows contacts, the rules for getting in, the boats, the dates and the booking link", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await encryptLocationAccess(
        { db: tx, kms: createLocalKms(randomBytes(32)), now: () => WINTER },
        { tenantId: f.tenantId, locationId: f.locationId, gateCode: "2580" },
      );
      const card = await placeCard(tx, f.tenantId, f.locationId, WINTER);
      expect(card).toMatchObject({
        name: "Marinafirman marina",
        type: "marina",
        address: "Hamnvägen 1",
        ownerCustomer: { id: f.clubId, name: "Hamnens Båtklubb" },
        bookingPath: "/boka/marinafirman/m/hamnen",
      });
      expect(card?.contacts.map((c) => [c.name, c.role, c.phone, c.email])).toEqual([
        ["Hamnkaptenen", "Hamnkapten", "+46701119101", null],
        ["Kontoret", "Reception", null, "kontor@hamnen.test"],
      ]);
      expect(card?.rules).toMatchObject({ parking: "Grusplanen", gateCode: true, keyBox: false });
      expect(inspect(card, { depth: 10 })).not.toContain("2580");

      // The boat on land here now first, then the one that is here in the summer.
      expect(card?.boats.map((b) => [b.name, b.season, b.current, b.spotId])).toEqual([
        ["Andra båten", "winter", true, "C3"],
        ["Marinafirman båt", "summer", false, null],
      ]);
      expect(card?.boats[0]?.owners).toEqual([{ id: f.ownerTwoId, name: "Ägare Två" }]);
      expect(card?.launches).toEqual([
        { date: "2026-05-01", boats: 1 },
        { date: "2027-05-01", boats: 1 },
      ]);
      expect(card?.haulOuts).toEqual([{ date: "2026-10-15", boats: 2 }]);
    });
  });

  it("has no booking link without slugs, and no rules when none are stored", async () => {
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Utan länk", "+46701119103");
      const [yard] = await tx
        .select({ id: location.id })
        .from(location)
        .where(eq(location.name, "Utan länk varv"));
      const card = await placeCard(tx, f.tenantId, yard!.id, WINTER);
      expect(card).toMatchObject({ bookingPath: null, rules: null, contacts: [], boats: [] });
    });
  });

  it("is not there for another firm, nor for soft-deleted contacts and boats", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const other = await createTenantWithBoat(tx, "Annan", "+46701119104");
      expect(await placeCard(tx, other.tenantId, f.locationId, WINTER)).toBeNull();
      expect(await placeCard(tx, f.tenantId, other.locationId, WINTER)).toBeNull();

      await tx
        .update(locationContact)
        .set({ deletedAt: WINTER })
        .where(eq(locationContact.name, "Kontoret"));
      await tx.update(boat).set({ deletedAt: WINTER }).where(eq(boat.id, f.secondId));
      const card = await placeCard(tx, f.tenantId, f.locationId, WINTER);
      expect(card?.contacts.map((c) => c.name)).toEqual(["Hamnkaptenen"]);
      expect(card?.boats.map((b) => b.name)).toEqual(["Marinafirman båt"]);
    });
  });
});
