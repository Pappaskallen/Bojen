import { parseCustomerSheet } from "@bojen/core/onboarding";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { importPlaces, saveCustomerImport } from "../src/customer-import";
import { readImportFile, templateXlsx } from "../src/import-xlsx";
import {
  boat,
  boatOwnership,
  boatPlacement,
  consent,
  customer,
  customerSearch,
  engine,
  engineHoursReading,
  location,
} from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const NOW = new Date("2026-12-28T09:00:00Z");

async function firmWithMarina(tx: Tx) {
  const f = await createTenantWithBoat(tx, "Importfirman", "+46701230009");
  const [marina] = await tx
    .insert(location)
    .values({ tenantId: f.tenantId, type: "marina", name: "Bullandö Marina" })
    .returning({ id: location.id });
  return { ...f, marinaId: marina?.id ?? "" };
}

describe("the customer import", () => {
  it("reads its own template back and saves the examples whole", async () => {
    const cells = await readImportFile(await templateXlsx());
    await withRollback(async (tx) => {
      const f = await firmWithMarina(tx);
      const plan = parseCustomerSheet(cells, await importPlaces(tx, f.tenantId));
      expect(plan.problems).toEqual([]);
      const result = await saveCustomerImport(tx, f.tenantId, plan, NOW);
      expect(result).toEqual({ customers: 2, boats: 2, engines: 2, placements: 3, skipped: [] });

      const [anna] = await tx
        .select()
        .from(customer)
        .where(and(eq(customer.tenantId, f.tenantId), eq(customer.phone, "+46701740605")));
      expect(anna).toMatchObject({
        name: "Anna Exempelsson",
        type: "private",
        acquisitionChannel: "import",
      });
      const boats = await tx
        .select({ id: boat.id, make: boat.make, length: boat.lengthM })
        .from(boat)
        .innerJoin(boatOwnership, eq(boatOwnership.boatId, boat.id))
        .where(eq(boatOwnership.customerId, anna?.id ?? ""));
      expect(boats.map((b) => b.make).sort()).toEqual(["Buster", "Nimbus"]);
      const nimbus = boats.find((b) => b.make === "Nimbus");
      expect(nimbus?.length).toBe("9.60");

      const placements = await tx
        .select({
          season: boatPlacement.season,
          mode: boatPlacement.mode,
          spot: boatPlacement.spotId,
          launch: boatPlacement.launchDate,
          haul: boatPlacement.haulOutDate,
          location: boatPlacement.locationId,
        })
        .from(boatPlacement)
        .where(eq(boatPlacement.boatId, nimbus?.id ?? ""));
      expect(placements.sort((a, b) => a.season.localeCompare(b.season))).toEqual([
        {
          season: "summer",
          mode: "water",
          spot: "B14",
          launch: "2027-04-24",
          haul: "2027-10-16",
          location: f.marinaId,
        },
        {
          season: "winter",
          mode: "land",
          spot: null,
          launch: "2027-04-24",
          haul: "2026-10-16",
          location: f.marinaId,
        },
      ]);

      const [hours] = await tx
        .select({ hours: engineHoursReading.hours, source: engineHoursReading.source })
        .from(engineHoursReading)
        .innerJoin(engine, eq(engine.id, engineHoursReading.engineId))
        .where(and(eq(engine.boatId, nimbus?.id ?? ""), eq(engine.make, "Volvo Penta")));
      expect(hours).toEqual({ hours: "1240.0", source: "mechanic" });

      // Only Anna said yes to offers; the club did not.
      const consents = await tx
        .select({ customerId: consent.customerId, type: consent.type, source: consent.source })
        .from(consent)
        .where(and(eq(consent.tenantId, f.tenantId), eq(consent.source, "import")));
      expect(consents).toEqual([{ customerId: anna?.id, type: "marketing_sms", source: "import" }]);

      // The search finds an imported customer by the boat, through the database triggers.
      const [search] = await tx
        .select({ document: customerSearch.document })
        .from(customerSearch)
        .where(eq(customerSearch.customerId, anna?.id ?? ""));
      expect(search?.document.toLowerCase()).toContain("nimbus");
    });
  });

  it("leaves a customer already in the register as it is, so a list can be read twice", async () => {
    const cells = await readImportFile(await templateXlsx());
    await withRollback(async (tx) => {
      const f = await firmWithMarina(tx);
      const plan = parseCustomerSheet(cells, await importPlaces(tx, f.tenantId));
      await saveCustomerImport(tx, f.tenantId, plan, NOW);
      const again = await saveCustomerImport(tx, f.tenantId, plan, NOW);
      expect(again).toEqual({
        customers: 0,
        boats: 0,
        engines: 0,
        placements: 0,
        skipped: [
          { row: 2, name: "Anna Exempelsson" },
          { row: 4, name: "Saltsjö Exempelklubb" },
        ],
      });
    });
  });

  it("saves nothing from a list with errors, and knows only the firm's own places", async () => {
    const cells = await readImportFile(await templateXlsx());
    await withRollback(async (tx) => {
      const f = await createTenantWithBoat(tx, "Firma utan marina", "+46701230010");
      const other = await firmWithMarina(tx);
      expect((await importPlaces(tx, f.tenantId)).map((p) => p.name)).not.toContain(
        "Bullandö Marina",
      );
      const plan = parseCustomerSheet(cells, await importPlaces(tx, f.tenantId));
      expect(plan.problems.filter((p) => p.level === "error").map((p) => p.row)).toEqual([2, 2, 3]);
      await expect(saveCustomerImport(tx, f.tenantId, plan, NOW)).rejects.toThrow(/errors/);
      const names = await tx
        .select({ name: customer.name })
        .from(customer)
        .where(eq(customer.tenantId, f.tenantId));
      expect(names.map((n) => n.name)).not.toContain("Anna Exempelsson");
      expect(other.marinaId).not.toBe("");
    });
  });
});
