import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { createLocalKms } from "@bojen/adapters";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  decryptAccess,
  encryptAccess,
  encryptLocationAccess,
} from "../src/access";
import { connect } from "../src/client";
import { accessInfo, appUser, auditLog, boatPlacement, tenant } from "../src/schema";
import { createTenantWithBoat, type Tx } from "./helpers";

/** Every query and parameter the code sends, as text. */
const queryLog: string[] = [];
const connection = connect(undefined, {
  logger: { logQuery: (query, params) => queryLog.push(query, inspect(params, { depth: 5 })) },
});
afterAll(connection.close);

class Rollback extends Error {}
async function withRollback(fn: (tx: Tx) => Promise<void>) {
  try {
    await connection.db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const CODE = "4711#";
const KEY_LOCATION = "Under fendern vid aktern";
const GATE_CODE = "2580";
const KEY_BOX = "1397";
const PLAINTEXTS = [CODE, KEY_LOCATION, GATE_CODE, KEY_BOX];

/** The helper's visit starts 20 April 2027 06:00Z (08:00 in Stockholm). */
const visitStart = new Date("2027-04-20T06:00:00Z");
const hours = (n: number) => new Date(visitStart.getTime() + n * 3600 * 1000);

async function firmWithCodes(tx: Tx, now: { value: Date }) {
  const firm = await createTenantWithBoat(tx, "A", "+46700000001");
  // Where the boat is on the visit day: on land at the same marina over the winter.
  await tx.insert(boatPlacement).values({
    tenantId: firm.tenantId,
    boatId: firm.boatId,
    locationId: firm.locationId,
    season: "winter",
    mode: "land",
    haulOutDate: "2026-10-15",
    launchDate: "2027-05-01",
  });
  const deps = { db: tx, kms: createLocalKms(randomBytes(32)), now: () => now.value };
  await encryptAccess(deps, {
    tenantId: firm.tenantId,
    boatId: firm.boatId,
    code: CODE,
    keyLocation: KEY_LOCATION,
    contactName: "Hamnkaptenen",
  });
  await encryptLocationAccess(deps, {
    tenantId: firm.tenantId,
    locationId: firm.locationId,
    gateCode: GATE_CODE,
    keyBox: KEY_BOX,
  });
  return { ...firm, deps };
}

async function auditRows(tx: Tx, tenantId: string) {
  return tx
    .select({ userId: auditLog.userId, action: auditLog.action, details: auditLog.details })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.subjectType, "visit")));
}

async function refusal(promise: Promise<unknown>): Promise<AccessDeniedError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AccessDeniedError) return error;
    throw error;
  }
  throw new Error("Expected access to be refused");
}

describe("encryptAccess and decryptAccess (step 1.6)", () => {
  it("stores only ciphertext and a wrapped data key", async () => {
    await withRollback(async (tx) => {
      const { tenantId, boatId } = await firmWithCodes(tx, { value: visitStart });
      const [row] = await tx.select().from(accessInfo).where(eq(accessInfo.boatId, boatId));
      expect(row!.codeEncrypted!.includes(Buffer.from(CODE))).toBe(false);
      expect(row!.keyLocationEncrypted!.includes(Buffer.from(KEY_LOCATION))).toBe(false);
      expect(row!.contactName).toBe("Hamnkaptenen");

      const [firm] = await tx.select().from(tenant).where(eq(tenant.id, tenantId));
      expect(firm!.dataKeyEncrypted).toBeInstanceOf(Buffer);
    });
  });

  it("gives the assigned mechanic the codes within 12 hours of the start, and logs it", async () => {
    await withRollback(async (tx) => {
      const now = { value: hours(-11) }; // 21:00 the evening before, when the app syncs
      const { tenantId, mechanicId, visitId, deps } = await firmWithCodes(tx, now);

      const access = await decryptAccess(deps, mechanicId, visitId);
      expect(access.code?.reveal()).toBe(CODE);
      expect(access.keyLocation?.reveal()).toBe(KEY_LOCATION);
      expect(access.gateCode?.reveal()).toBe(GATE_CODE);
      expect(access.keyBox?.reveal()).toBe(KEY_BOX);
      expect(access.contactName).toBe("Hamnkaptenen");

      expect(await auditRows(tx, tenantId)).toContainEqual({
        userId: mechanicId,
        action: "access_code_viewed",
        details: { reason: "assigned_mechanic" },
      });
    });
  });

  it("refuses and logs outside the window, for another mechanic and for an admin", async () => {
    await withRollback(async (tx) => {
      const now = { value: hours(-13) };
      const { tenantId, mechanicId, visitId, deps } = await firmWithCodes(tx, now);
      const viewedBefore = (await auditRows(tx, tenantId)).filter(
        (r) => r.action === "access_code_viewed",
      ).length;

      expect((await refusal(decryptAccess(deps, mechanicId, visitId))).reason).toBe(
        "outside_window",
      );
      now.value = hours(13);
      expect((await refusal(decryptAccess(deps, mechanicId, visitId))).reason).toBe(
        "outside_window",
      );

      now.value = visitStart;
      const [colleague, admin] = await tx
        .insert(appUser)
        .values([
          { tenantId, name: "Kollega", role: "mechanic" },
          { tenantId, name: "Kontoret", role: "admin" },
        ])
        .returning();
      expect((await refusal(decryptAccess(deps, colleague!.id, visitId))).reason).toBe(
        "not_assigned",
      );
      expect((await refusal(decryptAccess(deps, admin!.id, visitId))).reason).toBe(
        "role_not_allowed",
      );

      const rows = await auditRows(tx, tenantId);
      expect(rows.filter((r) => r.action === "access_code_denied")).toEqual([
        { userId: mechanicId, action: "access_code_denied", details: { reason: "outside_window" } },
        { userId: mechanicId, action: "access_code_denied", details: { reason: "outside_window" } },
        {
          userId: colleague!.id,
          action: "access_code_denied",
          details: { reason: "not_assigned" },
        },
        {
          userId: admin!.id,
          action: "access_code_denied",
          details: { reason: "role_not_allowed" },
        },
      ]);
      expect(rows.filter((r) => r.action === "access_code_viewed")).toHaveLength(viewedBefore);
    });
  });

  it("refuses a mechanic from another firm and logs it in that firm", async () => {
    await withRollback(async (tx) => {
      const { visitId, deps } = await firmWithCodes(tx, { value: visitStart });
      const other = await createTenantWithBoat(tx, "B", "+46700000002");

      expect((await refusal(decryptAccess(deps, other.mechanicId, visitId))).reason).toBe(
        "visit_not_found",
      );
      expect(await auditRows(tx, other.tenantId)).toContainEqual({
        userId: other.mechanicId,
        action: "access_code_denied",
        details: { reason: "visit_not_found" },
      });
    });
  });

  it("lets the owner see the codes at any time, with a log row", async () => {
    await withRollback(async (tx) => {
      const { tenantId, visitId, deps } = await firmWithCodes(tx, { value: hours(-24 * 30) });
      const [owner] = await tx
        .insert(appUser)
        .values({ tenantId, name: "Ägaren", role: "owner" })
        .returning();
      const access = await decryptAccess(deps, owner!.id, visitId);
      expect(access.code?.reveal()).toBe(CODE);
      expect(await auditRows(tx, tenantId)).toContainEqual({
        userId: owner!.id,
        action: "access_code_viewed",
        details: { reason: "owner" },
      });
    });
  });

  describe("no plaintext in any output", () => {
    const output: string[] = [];
    const capture = (...args: unknown[]) => {
      output.push(
        args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 5 }))).join(" "),
      );
      return true;
    };

    beforeEach(() => {
      output.length = 0;
      queryLog.length = 0;
      for (const method of ["log", "info", "warn", "error", "debug"] as const) {
        vi.spyOn(console, method).mockImplementation(capture);
      }
      vi.spyOn(process.stdout, "write").mockImplementation(capture);
      vi.spyOn(process.stderr, "write").mockImplementation(capture);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("finds no code in console output, queries, errors, results or the audit log", async () => {
      await withRollback(async (tx) => {
        const now = { value: visitStart };
        const { tenantId, mechanicId, visitId, deps } = await firmWithCodes(tx, now);

        // The ways a careless caller might log what came back.
        const access = await decryptAccess(deps, mechanicId, visitId);
        console.info("access", access);
        // eslint-disable-next-line no-console -- deliberately logs the result to look for leaks
        console.log(JSON.stringify(access));
        // eslint-disable-next-line no-console -- deliberately logs the result to look for leaks
        console.log(`code: ${String(access.code)}`);

        now.value = hours(-48);
        const error = await refusal(decryptAccess(deps, mechanicId, visitId));
        console.error(error);

        const audit = await auditRows(tx, tenantId);
        output.push(inspect(audit, { depth: 5 }), JSON.stringify(audit));

        // The test must not be vacuous: the captured output and query log are not empty.
        expect(output.length).toBeGreaterThan(3);
        expect(queryLog.length).toBeGreaterThan(10);

        const everything = [...output, ...queryLog].join("\n");
        for (const plaintext of PLAINTEXTS) {
          expect({ plaintext, found: everything.includes(plaintext) }).toEqual({
            plaintext,
            found: false,
          });
        }
        expect(everything).toContain("[redacted]");
      });
    });
  });
});
