import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { distanceBetweenLocations, placementOn } from "../src/queries/location";
import { area, boat, boatPlacement, location, tenant } from "../src/schema";
import { closeDb, createTenantWithBoat, expectDbError, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const sandhamn = { lng: 18.9105, lat: 59.2885 };
const stavsnas = { lng: 18.6925, lat: 59.2862 };

/** Great-circle distance on a sphere, as an independent check of PostGIS. */
function haversineMetres(a: typeof sandhamn, b: typeof sandhamn): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

async function firmWithTwoMarinas(tx: Tx) {
  const [firm] = await tx.insert(tenant).values({ name: "Skärgårdsmek" }).returning();
  const tenantId = firm!.id;
  const [summerMarina, winterYard] = await tx
    .insert(location)
    .values([
      {
        tenantId,
        type: "marina",
        name: "Sandhamns gästhamn",
        position: sandhamn,
        accessMethod: "boat",
        crossingMinutes: 25,
      },
      { tenantId, type: "yard", name: "Stavsnäs vinterhamn", position: stavsnas },
    ])
    .returning();
  const [b] = await tx.insert(boat).values({ tenantId, name: "Solvik" }).returning();
  return { tenantId, boatId: b!.id, summerMarina: summerMarina!, winterYard: winterYard! };
}

describe("locations and placements (step 1.2)", () => {
  it("finds the placement that applies to a boat on a given date", async () => {
    await withRollback(async (tx) => {
      const { tenantId, boatId, summerMarina, winterYard } = await firmWithTwoMarinas(tx);
      await tx.insert(boatPlacement).values([
        {
          tenantId,
          boatId,
          locationId: summerMarina.id,
          season: "summer",
          mode: "water",
          spotId: "B14",
          launchDate: "2026-05-01",
          haulOutDate: "2026-10-15",
        },
        {
          tenantId,
          boatId,
          locationId: winterYard.id,
          season: "winter",
          mode: "land",
          spotId: "Rad 3",
          haulOutDate: "2026-10-15",
          launchDate: "2027-05-01",
        },
      ]);

      const july = await placementOn(tx, boatId, "2026-07-01");
      expect(july?.placement.season).toBe("summer");
      expect(july?.placement.spotId).toBe("B14");
      expect(july?.location.name).toBe("Sandhamns gästhamn");
      expect(july?.location.position).toEqual(sandhamn);

      const january = await placementOn(tx, boatId, "2027-01-15");
      expect(january?.placement.season).toBe("winter");
      expect(january?.placement.mode).toBe("land");
      expect(january?.location.name).toBe("Stavsnäs vinterhamn");

      // The boat is hauled out on the morning of 15 October.
      expect((await placementOn(tx, boatId, "2026-10-14"))?.placement.season).toBe("summer");
      expect((await placementOn(tx, boatId, "2026-10-15"))?.placement.season).toBe("winter");

      // Before the first launch nothing is known.
      expect(await placementOn(tx, boatId, "2026-04-01")).toBeUndefined();
    });
  });

  it("refuses two placements for the same boat on the same day", async () => {
    await withRollback(async (tx) => {
      const { tenantId, boatId, summerMarina, winterYard } = await firmWithTwoMarinas(tx);
      await tx.insert(boatPlacement).values({
        tenantId,
        boatId,
        locationId: summerMarina.id,
        season: "summer",
        mode: "water",
        launchDate: "2026-05-01",
        haulOutDate: "2026-10-15",
      });

      const error = await expectDbError(tx, (sp) =>
        sp.insert(boatPlacement).values({
          tenantId,
          boatId,
          locationId: winterYard.id,
          season: "winter",
          mode: "land",
          haulOutDate: "2026-09-01",
        }),
      );
      expect(String(error.cause ?? error)).toMatch(/boat_placement_no_overlap/);
    });
  });

  it("measures the distance between two marinas", async () => {
    await withRollback(async (tx) => {
      const { summerMarina, winterYard } = await firmWithTwoMarinas(tx);

      const metres = await distanceBetweenLocations(tx, summerMarina.id, winterYard.id);
      expect(metres).not.toBeNull();
      // PostGIS measures on the WGS 84 ellipsoid; the sphere differs by well under 1 %.
      expect(metres!).toBeGreaterThan(12_000);
      expect(metres!).toBeLessThan(13_000);
      expect(Math.abs(metres! - haversineMetres(sandhamn, stavsnas)) / metres!).toBeLessThan(0.01);

      // Nearest first: Stavsnäs is closer than Sandhamn to a point in Stavsnäs harbour.
      const near = await tx
        .select({ name: location.name })
        .from(location)
        .where(sql`ST_DWithin(${location.position}, ST_MakePoint(18.69, 59.286)::geography, 20000)`)
        .orderBy(sql`${location.position} <-> ST_MakePoint(18.69, 59.286)::geography`);
      expect(near.map((r) => r.name)).toEqual(["Stavsnäs vinterhamn", "Sandhamns gästhamn"]);
    });
  });

  it("returns null distance when a location has no position yet", async () => {
    await withRollback(async (tx) => {
      const { tenantId, summerMarina } = await firmWithTwoMarinas(tx);
      const [home] = await tx
        .insert(location)
        .values({ tenantId, type: "home", name: "Kundens brygga" })
        .returning();
      expect(await distanceBetweenLocations(tx, summerMarina.id, home!.id)).toBeNull();
    });
  });

  it("stores an area polygon and finds the locations inside it", async () => {
    await withRollback(async (tx) => {
      const { tenantId } = await firmWithTwoMarinas(tx);
      const ring = [
        { lng: 18.85, lat: 59.25 },
        { lng: 18.95, lat: 59.25 },
        { lng: 18.95, lat: 59.32 },
        { lng: 18.85, lat: 59.32 },
        { lng: 18.85, lat: 59.25 },
      ];
      const [sandhamnArea] = await tx
        .insert(area)
        .values({ tenantId, name: "Sandhamn", boundary: [ring] })
        .returning();
      expect(sandhamnArea!.boundary).toEqual([ring]);

      const inside = await tx
        .select({ name: location.name })
        .from(location)
        .innerJoin(area, sql`ST_Covers(${area.boundary}, ${location.position})`)
        .where(eq(area.id, sandhamnArea!.id));
      expect(inside.map((r) => r.name)).toEqual(["Sandhamns gästhamn"]);
    });
  });

  it("refuses placements at another tenant's location", async () => {
    await withRollback(async (tx) => {
      const a = await createTenantWithBoat(tx, "A", "+46700000001");
      const b = await createTenantWithBoat(tx, "B", "+46700000002");
      const error = await expectDbError(tx, (sp) =>
        sp.insert(boatPlacement).values({
          tenantId: a.tenantId,
          boatId: a.boatId,
          locationId: b.locationId,
          season: "winter",
          mode: "land",
          haulOutDate: "2027-10-15",
        }),
      );
      expect(String(error.cause ?? error)).toMatch(/boat_placement_location_fk/);
    });
  });
});
