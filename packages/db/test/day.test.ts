import { createFakeMaps, createFakeStorage } from "@bojen/adapters";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  DayError,
  addPart,
  addVisitPhoto,
  dayRoute,
  dayVisits,
  recordHours,
  setPartStatus,
} from "../src/day";
import {
  appUser,
  attachment,
  boat,
  boatOwnership,
  boatPlacement,
  customer,
  engineHoursReading,
  job,
  jobPart,
  location,
  part,
  visit,
} from "../src/schema";
import { timeRange } from "../src/schema/_types";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

/** The helper's visit is 20 April 2027, 08:00–10:00 in Stockholm. */
const DAY = "2027-04-20";
const NOW = new Date("2027-04-20T05:00:00Z");

async function firm(tx: Tx) {
  const f = await createTenantWithBoat(tx, "Dagfirman", "+46701119201");
  // The boat is at the marina that day.
  await tx.insert(boatPlacement).values({
    tenantId: f.tenantId,
    boatId: f.boatId,
    locationId: f.locationId,
    season: "winter",
    mode: "land",
    spotId: "B14",
    haulOutDate: "2026-10-15",
    launchDate: "2027-05-01",
  });
  const [other, owner] = await tx
    .insert(appUser)
    .values([
      { tenantId: f.tenantId, name: "Annan mekaniker", role: "mechanic" },
      { tenantId: f.tenantId, name: "Ägaren", role: "owner" },
    ])
    .returning();
  const me = { tenantId: f.tenantId, userId: f.mechanicId, role: "mechanic" as const };
  return { ...f, me, otherId: other!.id, ownerId: owner!.id };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof DayError ? e.code : String(e)),
  );

describe("the mechanic's day", () => {
  it("lists the mechanic's visits that day with customer, boat, place, engines and parts", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const visits = await dayVisits(tx, f.tenantId, f.mechanicId, DAY);
      expect(visits).toHaveLength(1);
      expect(visits[0]).toMatchObject({
        id: f.visitId,
        status: "booked",
        window: 0,
        service: "Vårservice",
        customer: { name: "Dagfirman kund", phone: "+46701119201" },
        boat: { label: "Dagfirman båt" },
        place: { id: f.locationId, spotId: "B14", mode: "land" },
        engines: [{ id: f.engineId, lastHours: 412.5 }],
        photos: 0,
      });
      expect(visits[0]?.parts.map((p) => [p.articleNumber, p.status])).toEqual([
        ["21951346", "needed"],
      ]);
      // Another day, another mechanic, or a cancelled visit: nothing.
      expect(await dayVisits(tx, f.tenantId, f.mechanicId, "2027-04-21")).toEqual([]);
      expect(await dayVisits(tx, f.tenantId, f.otherId, DAY)).toEqual([]);
      await tx.update(visit).set({ status: "cancelled" }).where(eq(visit.id, f.visitId));
      expect(await dayVisits(tx, f.tenantId, f.mechanicId, DAY)).toEqual([]);
    });
  });

  it("suggests the order with the shortest drive, within the promised windows", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      // Two more morning visits: one at the yard, one back at the marina.
      const [c] = await tx
        .insert(customer)
        .values({ tenantId: f.tenantId, name: "Kund två", phone: "+46701119202" })
        .returning();
      const [yard] = await tx
        .select({ id: location.id })
        .from(location)
        .where(and(eq(location.tenantId, f.tenantId), eq(location.name, "Dagfirman varv")));
      const addVisit = async (placeId: string, start: string) => {
        const [b] = await tx
          .insert(boat)
          .values({ tenantId: f.tenantId, name: `Båt ${start}` })
          .returning();
        await tx
          .insert(boatOwnership)
          .values({ tenantId: f.tenantId, boatId: b!.id, customerId: c!.id });
        await tx.insert(boatPlacement).values({
          tenantId: f.tenantId,
          boatId: b!.id,
          locationId: placeId,
          season: "winter",
          mode: "land",
          haulOutDate: "2026-10-15",
          launchDate: "2027-05-01",
        });
        const [j] = await tx
          .insert(job)
          .values({ tenantId: f.tenantId, customerId: c!.id, boatId: b!.id, channel: "phone" })
          .returning();
        const s = new Date(start);
        await tx.insert(visit).values({
          tenantId: f.tenantId,
          jobId: j!.id,
          mechanicId: f.mechanicId,
          timeWindow: timeRange(s, new Date(s.getTime() + 30 * 60_000)),
          plannedMinutes: 30,
          status: "booked",
        });
      };
      // Booked: marina 08:00 (helper), yard 10:15, marina 10:45 → marina, yard, marina.
      await addVisit(yard!.id, "2027-04-20T08:15:00Z");
      await addVisit(f.locationId, "2027-04-20T08:45:00Z");

      const visits = await dayVisits(tx, f.tenantId, f.mechanicId, DAY);
      const route = await dayRoute({ db: tx, maps: createFakeMaps() }, f.tenantId, visits, NOW);
      expect(route.exhaustive).toBe(true);
      // The helper's travel cache has 10 minutes from the marina to the yard; both marina visits
      // first saves one of the two trips.
      expect(route.suggestedSeconds).toBeLessThan(route.bookedSeconds);
      const places = route.order.map((id) => visits.find((v) => v.id === id)?.place?.id);
      expect(places).toEqual([f.locationId, f.locationId, yard!.id]);
    });
  });
});

describe("what the mechanic records on site", () => {
  it("records running hours, never lower than the last reading", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await recordHours(tx, f.me, f.visitId, f.engineId, 430.4, NOW);
      const readings = await tx
        .select({ hours: engineHoursReading.hours, source: engineHoursReading.source })
        .from(engineHoursReading)
        .where(eq(engineHoursReading.engineId, f.engineId));
      expect(readings).toContainEqual({ hours: "430.4", source: "mechanic" });
      expect(await code(recordHours(tx, f.me, f.visitId, f.engineId, 400, NOW))).toBe(
        "hours_below_last",
      );
      expect(await code(recordHours(tx, f.me, f.visitId, f.engineId, -1, NOW))).toBe(
        "invalid_input",
      );
      expect(await code(recordHours(tx, f.me, f.visitId, f.engineId, Number.NaN, NOW))).toBe(
        "invalid_input",
      );
    });
  });

  it("adds a part from the van as installed, reusing a known article number", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      // The helper's part, by article number: no new part is made.
      await addPart(tx, f.me, f.visitId, { articleNumber: "21951346", quantity: 2 });
      // A new one needs a description.
      expect(await code(addPart(tx, f.me, f.visitId, { articleNumber: "NY-1" }))).toBe(
        "invalid_input",
      );
      await addPart(tx, f.me, f.visitId, { articleNumber: "NY-1", description: "Zinkanod" });
      const parts = await tx.select().from(part).where(eq(part.tenantId, f.tenantId));
      expect(parts.map((p) => p.articleNumber).sort()).toEqual(["21951346", "NY-1"]);
      const rows = await tx
        .select({ status: jobPart.status, quantity: jobPart.quantity, source: jobPart.source })
        .from(jobPart)
        .where(and(eq(jobPart.jobId, f.jobId), eq(jobPart.source, "van")));
      expect(rows).toEqual(
        expect.arrayContaining([
          { status: "installed", quantity: "2.00", source: "van" },
          { status: "installed", quantity: "1.00", source: "van" },
        ]),
      );
    });
  });

  it("marks a part installed", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const [jp] = await tx.select().from(jobPart).where(eq(jobPart.jobId, f.jobId));
      await setPartStatus(tx, f.me, f.visitId, jp!.id, "installed");
      const [after] = await tx.select().from(jobPart).where(eq(jobPart.id, jp!.id));
      expect(after?.status).toBe("installed");
      expect(await code(setPartStatus(tx, f.me, f.visitId, jp!.id, "eaten"))).toBe("invalid_input");
    });
  });

  it("saves a picture in the firm's folder, and refuses what is not a picture", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const storage = createFakeStorage();
      await addVisitPhoto({ db: tx, storage }, f.me, f.visitId, {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/jpeg",
      });
      const [saved] = await tx
        .select()
        .from(attachment)
        .where(and(eq(attachment.ownerType, "visit"), eq(attachment.ownerId, f.visitId)));
      expect(saved?.storageKey).toMatch(new RegExp(`^${f.tenantId}/visits/${f.visitId}/.+\\.jpg$`));
      expect(storage.objects.has(saved!.storageKey)).toBe(true);
      expect(
        await code(
          addVisitPhoto({ db: tx, storage }, f.me, f.visitId, {
            bytes: new Uint8Array([1]),
            contentType: "application/pdf",
          }),
        ),
      ).toBe("bad_picture");
      expect(
        await code(
          addVisitPhoto({ db: tx, storage }, f.me, f.visitId, {
            bytes: new Uint8Array(),
            contentType: "image/png",
          }),
        ),
      ).toBe("bad_picture");
    });
  });

  it("lets only the visit's mechanic, the owner and an administrator record", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const other = { tenantId: f.tenantId, userId: f.otherId, role: "mechanic" as const };
      const owner = { tenantId: f.tenantId, userId: f.ownerId, role: "owner" as const };
      expect(await code(recordHours(tx, other, f.visitId, f.engineId, 500, NOW))).toBe("forbidden");
      expect(await code(addPart(tx, other, f.visitId, { articleNumber: "21951346" }))).toBe(
        "forbidden",
      );
      expect(await code(recordHours(tx, owner, f.visitId, f.engineId, 500, NOW))).toBe("ok");
      // Another firm's visit is not found at all.
      const g = await createTenantWithBoat(tx, "Annan", "+46701119203");
      const stranger = { tenantId: g.tenantId, userId: g.mechanicId, role: "mechanic" as const };
      expect(await code(recordHours(tx, stranger, f.visitId, f.engineId, 600, NOW))).toBe(
        "not_found",
      );
      // An engine of another boat is refused.
      expect(await code(recordHours(tx, f.me, f.visitId, g.engineId, 600, NOW))).toBe("not_found");
    });
  });
});
