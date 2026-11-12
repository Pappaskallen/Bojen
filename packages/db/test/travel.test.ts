import { createFakeMaps } from "@bojen/adapters";
import { estimateDrive } from "@bojen/core";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { location, tenant, travelCache } from "../src/schema";
import { TravelError, travelTimes } from "../src/travel";
import { closeDb, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const BULLANDO = { lng: 18.64, lat: 59.29 };
const STAVSNAS = { lng: 18.69, lat: 59.29 };
const SANDHAMN = { lng: 18.91, lat: 59.29 };
const LEAVE = new Date("2027-06-15T06:20:00Z");

async function firmWithPlaces(tx: Tx) {
  const [firm] = await tx.insert(tenant).values({ name: "Restidsfirman" }).returning();
  const tenantId = firm!.id;
  const [bullando, stavsnas, sandhamn, unplaced] = await tx
    .insert(location)
    .values([
      { tenantId, type: "marina", name: "Bullandö", position: BULLANDO },
      { tenantId, type: "marina", name: "Stavsnäs", position: STAVSNAS },
      {
        tenantId,
        type: "marina",
        name: "Sandhamn",
        position: SANDHAMN,
        accessMethod: "ferry",
        crossingMinutes: 50,
      },
      { tenantId, type: "home", name: "Ej geokodad" },
    ])
    .returning();
  return {
    tenantId,
    bullando: bullando!.id,
    stavsnas: stavsnas!.id,
    sandhamn: sandhamn!.id,
    unplaced: unplaced!.id,
  };
}

describe("travelTimes", () => {
  it("asks the maps provider once and uses the cache on the second call", async () => {
    await withRollback(async (tx) => {
      const f = await firmWithPlaces(tx);
      const maps = createFakeMaps();
      const pairs = [
        { fromId: f.bullando, toId: f.stavsnas },
        { fromId: f.stavsnas, toId: f.bullando },
      ];

      const first = await travelTimes({ db: tx, maps }, f.tenantId, pairs, LEAVE);
      expect(maps.calls).toHaveLength(1);
      expect(maps.calls[0]?.departure.toISOString()).toBe("2027-06-15T06:00:00.000Z");

      // Same hour, a few minutes later: no new request.
      const second = await travelTimes(
        { db: tx, maps },
        f.tenantId,
        pairs,
        new Date("2027-06-15T06:55:00Z"),
      );
      expect(maps.calls).toHaveLength(1);
      expect(second).toEqual(first);
      expect(first[0]?.driveSeconds).toBe(estimateDrive(BULLANDO, STAVSNAS).seconds);

      const rows = await tx.select().from(travelCache).where(eq(travelCache.tenantId, f.tenantId));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.provider === "fake")).toBe(true);

      // A new hour is a new cache entry.
      await travelTimes({ db: tx, maps }, f.tenantId, pairs, new Date("2027-06-15T07:00:00Z"));
      expect(maps.calls).toHaveLength(2);
    });
  });

  it("only asks for the pairs that are missing", async () => {
    await withRollback(async (tx) => {
      const f = await firmWithPlaces(tx);
      const maps = createFakeMaps();
      await travelTimes(
        { db: tx, maps },
        f.tenantId,
        [{ fromId: f.bullando, toId: f.stavsnas }],
        LEAVE,
      );
      await travelTimes(
        { db: tx, maps },
        f.tenantId,
        [
          { fromId: f.bullando, toId: f.stavsnas },
          { fromId: f.bullando, toId: f.sandhamn },
        ],
        LEAVE,
      );
      expect(maps.calls).toHaveLength(2);
      expect(maps.calls[1]?.destinations).toEqual([SANDHAMN]);
    });
  });

  it("adds the ferry crossing to and from the island", async () => {
    await withRollback(async (tx) => {
      const f = await firmWithPlaces(tx);
      const maps = createFakeMaps();
      const [out, back, mainland] = await travelTimes(
        { db: tx, maps },
        f.tenantId,
        [
          { fromId: f.stavsnas, toId: f.sandhamn },
          { fromId: f.sandhamn, toId: f.stavsnas },
          { fromId: f.stavsnas, toId: f.bullando },
        ],
        LEAVE,
      );
      const drive = estimateDrive(STAVSNAS, SANDHAMN).seconds;
      expect(out?.seconds).toBe(drive + 50 * 60);
      expect(back?.seconds).toBe(drive + 50 * 60);
      expect(mainland?.seconds).toBe(mainland?.driveSeconds);

      // The crossing is read from the place, so a new crossing time applies at once.
      await tx.update(location).set({ crossingMinutes: 30 }).where(eq(location.id, f.sandhamn));
      const [again] = await travelTimes(
        { db: tx, maps },
        f.tenantId,
        [{ fromId: f.stavsnas, toId: f.sandhamn }],
        LEAVE,
      );
      expect(again?.seconds).toBe(drive + 30 * 60);
      expect(maps.calls).toHaveLength(1);
    });
  });

  it("takes no time at the same place and does not ask for it", async () => {
    await withRollback(async (tx) => {
      const f = await firmWithPlaces(tx);
      const maps = createFakeMaps();
      const [same] = await travelTimes(
        { db: tx, maps },
        f.tenantId,
        [{ fromId: f.sandhamn, toId: f.sandhamn }],
        LEAVE,
      );
      expect(same?.seconds).toBe(0);
      expect(maps.calls).toHaveLength(0);
    });
  });

  it("refuses places that are not geocoded, belong to another firm or have no road", async () => {
    await withRollback(async (tx) => {
      const f = await firmWithPlaces(tx);
      const other = await firmWithPlaces(tx);
      const maps = createFakeMaps();
      const reason = async (fromId: string, toId: string) => {
        try {
          await travelTimes({ db: tx, maps }, f.tenantId, [{ fromId, toId }], LEAVE);
        } catch (error) {
          if (error instanceof TravelError) return error.reason;
          throw error;
        }
        return "ok";
      };
      expect(await reason(f.bullando, f.unplaced)).toBe("not_geocoded");
      expect(await reason(f.bullando, other.bullando)).toBe("unknown_location");

      const noRoads = { ...createFakeMaps(), driveMatrix: () => Promise.resolve([]) };
      await expect(
        travelTimes(
          { db: tx, maps: noRoads },
          f.tenantId,
          [{ fromId: f.bullando, toId: f.stavsnas }],
          LEAVE,
        ),
      ).rejects.toMatchObject({ reason: "no_route" });
    });
  });
});
