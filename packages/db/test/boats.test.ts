import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { createLocalKms } from "@bojen/adapters";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  encryptAccess,
  encryptLocationAccess,
  revealBoatAccess,
} from "../src/access";
import { boatCard } from "../src/boats";
import {
  appUser,
  attachment,
  auditLog,
  boatPlacement,
  domainEvent,
  engineHoursReading,
  visit,
} from "../src/schema";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const CODE = "4711#";
const KEY_LOCATION = "Under fendern vid aktern";
const GATE_CODE = "2580";
/** The helper's visit starts 20 April 2027 06:00Z (08:00 in Stockholm). */
const START = new Date("2027-04-20T06:00:00Z");
const hours = (n: number) => new Date(START.getTime() + n * 3_600_000);

async function firm(tx: Tx, now: Date = hours(-3)) {
  const f = await createTenantWithBoat(tx, "Båtfirman", "+46701119001");
  // On land at the marina over the winter, in the water in the summer.
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
  const deps = { db: tx, kms: createLocalKms(randomBytes(32)), now: () => now };
  await encryptAccess(deps, {
    tenantId: f.tenantId,
    boatId: f.boatId,
    code: CODE,
    keyLocation: KEY_LOCATION,
    contactName: "Hamnkaptenen",
  });
  await encryptLocationAccess(deps, {
    tenantId: f.tenantId,
    locationId: f.locationId,
    gateCode: GATE_CODE,
  });
  const [owner, otherMechanic, admin] = await tx
    .insert(appUser)
    .values([
      { tenantId: f.tenantId, name: "Ägaren", role: "owner" },
      { tenantId: f.tenantId, name: "Annan mekaniker", role: "mechanic" },
      { tenantId: f.tenantId, name: "Administratören", role: "admin" },
    ])
    .returning();
  return { ...f, deps, ownerId: owner!.id, otherMechanicId: otherMechanic!.id, adminId: admin!.id };
}

const audit = (tx: Tx, tenantId: string) =>
  tx
    .select({
      userId: auditLog.userId,
      action: auditLog.action,
      subjectId: auditLog.subjectId,
      details: auditLog.details,
    })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.subjectType, "boat")));

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AccessDeniedError) return error.reason;
    throw error;
  }
  throw new Error("Expected access to be refused");
}

describe("boat card", () => {
  it("shows the boat, owners, places, engines with hours, history, reports and pictures", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      await tx.insert(engineHoursReading).values([
        {
          tenantId: f.tenantId,
          engineId: f.engineId,
          hours: "380.0",
          readAt: new Date("2025-10-10T10:00:00Z"),
          source: "mechanic",
        },
        {
          tenantId: f.tenantId,
          engineId: f.engineId,
          hours: "350.5",
          readAt: new Date("2025-04-10T10:00:00Z"),
          source: "customer",
        },
      ]);
      await tx.update(visit).set({ status: "done" }).where(eq(visit.id, f.visitId));
      await tx.insert(domainEvent).values({
        tenantId: f.tenantId,
        aggregateType: "visit",
        aggregateId: f.visitId,
        type: "report.approved",
        payload: {
          workDone: "Bytt impeller och olja.",
          hours: "412",
          recommendations: "Byt bälgar nästa vår.",
          nextService: "Våren 2028",
        },
        actorType: "staff",
        actorId: f.mechanicId,
      });
      await tx.insert(attachment).values({
        tenantId: f.tenantId,
        ownerType: "boat",
        ownerId: f.boatId,
        storageKey: `${f.tenantId}/boats/${f.boatId}/akter.jpg`,
        contentType: "image/jpeg",
        sizeBytes: 900,
      });

      const card = await boatCard(tx, f.tenantId, f.boatId, new Date("2026-12-01T10:00:00Z"));
      expect(card).toMatchObject({ name: "Båtfirman båt", status: "active" });
      expect(card?.owners).toMatchObject([
        { customerId: f.customerId, name: "Båtfirman kund", role: "owner" },
      ]);
      // Both seasons, and which one is now (December: the winter place).
      expect(card?.placements.map((p) => [p.season, p.mode, p.current, p.spotId]).sort()).toEqual([
        ["summer", "water", false, null],
        ["winter", "land", true, "B14"],
      ]);
      expect(card?.engines).toHaveLength(1);
      expect(card?.engines[0]?.drive).toEqual({ type: "DPH", serialNumber: null });
      // Readings oldest first, as numbers.
      expect(card?.engines[0]?.hours.map((h) => h.hours)).toEqual([350.5, 380, 412.5]);
      expect(card?.history[0]).toMatchObject({
        id: f.visitId,
        status: "done",
        service: "Vårservice",
        report: { workDone: "Bytt impeller och olja.", recommendations: "Byt bälgar nästa vår." },
      });
      expect(card?.recommendations).toMatchObject({
        text: "Byt bälgar nästa vår.",
        nextService: "Våren 2028",
      });
      // The boat's own picture and the job picture from the helper.
      expect(card?.pictures.map((p) => p.storageKey).sort()).toEqual(
        [
          `${f.tenantId}/boats/${f.boatId}/akter.jpg`,
          `${f.tenantId}/jobs/${f.jobId}/drev.jpg`,
        ].sort(),
      );
    });
  });

  it("says which access information is stored, never what it says", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const card = await boatCard(tx, f.tenantId, f.boatId, new Date("2026-12-01T10:00:00Z"));
      expect(card?.access).toEqual({
        code: true,
        keyLocation: true,
        gateCode: true,
        keyBox: false,
        contactName: "Hamnkaptenen",
        contactPhone: null,
      });
      const everything = inspect(card, { depth: 10 });
      for (const secret of [CODE, KEY_LOCATION, GATE_CODE]) {
        expect(everything).not.toContain(secret);
      }
    });
  });

  it("is not there for another firm", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const other = await createTenantWithBoat(tx, "Annan", "+46701119002");
      expect(await boatCard(tx, other.tenantId, f.boatId, START)).toBeNull();
      expect(await boatCard(tx, f.tenantId, other.boatId, START)).toBeNull();
    });
  });
});

describe("showing the code from the boat card", () => {
  it("lets the owner see it at any time, and logs it against the boat", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx, new Date("2026-12-01T10:00:00Z"));
      const shown = await revealBoatAccess(f.deps, f.ownerId, f.boatId);
      expect(shown.code?.reveal()).toBe(CODE);
      expect(shown.keyLocation?.reveal()).toBe(KEY_LOCATION);
      // The gate code where the boat is today.
      expect(shown.gateCode?.reveal()).toBe(GATE_CODE);
      expect(shown.contactName).toBe("Hamnkaptenen");
      expect(await audit(tx, f.tenantId)).toEqual([
        {
          userId: f.ownerId,
          action: "access_code_viewed",
          subjectId: f.boatId,
          details: { reason: "owner" },
        },
      ]);
    });
  });

  it("lets the mechanic with a visit within 12 hours see it, and logs the visit", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx, hours(-3));
      const shown = await revealBoatAccess(f.deps, f.mechanicId, f.boatId);
      expect(shown.code?.reveal()).toBe(CODE);
      expect(await audit(tx, f.tenantId)).toEqual([
        {
          userId: f.mechanicId,
          action: "access_code_viewed",
          subjectId: f.boatId,
          details: { reason: "assigned_mechanic", visitId: f.visitId },
        },
      ]);
    });
  });

  it("refuses a mechanic without a visit to the boat, and logs the refusal", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx, hours(-3));
      expect(await refusal(revealBoatAccess(f.deps, f.otherMechanicId, f.boatId))).toBe(
        "not_assigned",
      );
      expect(await audit(tx, f.tenantId)).toEqual([
        {
          userId: f.otherMechanicId,
          action: "access_code_denied",
          subjectId: f.boatId,
          details: { reason: "not_assigned" },
        },
      ]);
    });
  });

  it("refuses the visit's mechanic too early, after a cancellation, and an administrator", async () => {
    await withRollback(async (tx) => {
      const early = await firm(tx, hours(-13));
      expect(await refusal(revealBoatAccess(early.deps, early.mechanicId, early.boatId))).toBe(
        "outside_window",
      );
      expect(await refusal(revealBoatAccess(early.deps, early.adminId, early.boatId))).toBe(
        "role_not_allowed",
      );
    });
    await withRollback(async (tx) => {
      const f = await firm(tx, hours(-3));
      await tx.update(visit).set({ status: "cancelled" }).where(eq(visit.id, f.visitId));
      expect(await refusal(revealBoatAccess(f.deps, f.mechanicId, f.boatId))).toBe("not_assigned");
    });
  });

  it("refuses a boat of another firm", async () => {
    await withRollback(async (tx) => {
      const f = await firm(tx);
      const other = await createTenantWithBoat(tx, "Annan", "+46701119003");
      expect(await refusal(revealBoatAccess(f.deps, f.ownerId, other.boatId))).toBe(
        "boat_not_found",
      );
      expect(await audit(tx, f.tenantId)).toMatchObject([
        { action: "access_code_denied", details: { reason: "boat_not_found" } },
      ]);
    });
  });
});
