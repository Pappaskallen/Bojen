import { randomBytes } from "node:crypto";
import { createLocalKms } from "@bojen/adapters";
import { decryptField, fieldAad } from "@bojen/core/crypto";
import { linkHash } from "@bojen/core/links";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { BookingError } from "../src/booking";
import { accessInfo, domainEvent, shortLink, tenant, visit } from "../src/schema";
import {
  cancelByLink,
  createShortLink,
  findShortLink,
  managePage,
  rescheduleByLink,
  saveAccessByLink,
} from "../src/short-links";
import { closeDb, createTenantWithBoat, withRollback, type Tx } from "./helpers";

afterAll(closeDb);

const KEY = "short-link-test-key-not-a-secret-0123456789";
/** The helper's visit: Tuesday 20 April 2027, 08:00–10:00 in Stockholm. */
const START = new Date("2027-04-20T06:00:00Z");
/** Monday 19 April 08:00 in Stockholm, inside the mechanic's Monday hours 07–17. */
const MONDAY = new Date("2027-04-19T06:00:00Z");
const EARLY = new Date("2027-04-01T08:00:00Z");

async function setup(tx: Tx, now = EARLY) {
  const f = await createTenantWithBoat(tx, "Länkfirman", "+46701230001");
  // The helper seeds one link already; start from none.
  await tx.delete(shortLink).where(eq(shortLink.tenantId, f.tenantId));
  const code = await createShortLink(tx, KEY, {
    tenantId: f.tenantId,
    visitId: f.visitId,
    purpose: "manage",
    expiresAt: START,
  });
  const deps = (at = now) => ({ db: tx, now: () => at, linkKey: KEY });
  return { ...f, code, deps };
}

const errorCode = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof BookingError ? e.code : String(e)),
  );

describe("short links", () => {
  it("store only a keyed hash of the code", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const [row] = await tx.select().from(shortLink).where(eq(shortLink.tenantId, f.tenantId));
      expect(row?.codeHash).toBe(linkHash(KEY, f.code));
      expect(JSON.stringify(row)).not.toContain(f.code);
      expect(await findShortLink(tx, KEY, f.code)).toMatchObject({ visitId: f.visitId });
      // Another key, a malformed code or an unknown code find nothing.
      expect(await findShortLink(tx, "another-key", f.code)).toBeNull();
      expect(await findShortLink(tx, KEY, "../../x")).toBeNull();
      expect(await findShortLink(tx, KEY, "AAAAAAAA")).toBeNull();
    });
  });

  it("show the booking while valid, and a reason once expired", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const page = await managePage(f.deps(), f.code);
      expect(page.state).toBe("valid");
      if (page.state !== "valid") return;
      expect(page.visit.visitId).toBe(f.visitId);
      expect(page.mayChange).toBe(true);
      expect(page.cancelBy).toBe("sön 18/4 kl 08");

      expect(await managePage(f.deps(START), f.code)).toMatchObject({ state: "expired" });
      expect(await managePage(f.deps(), "Zz9Zz9Zz")).toEqual({ state: "missing" });
    });
  });

  it("follow the firm's cancellation limit", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const late = new Date(START.getTime() - 24 * 3_600_000);
      const page = await managePage(f.deps(late), f.code);
      expect(page).toMatchObject({ state: "valid", mayChange: false });
      expect(await errorCode(cancelByLink(f.deps(late), f.code))).toBe("too_late");
    });
  });

  it("reschedule as the customer, free the old time and use up the link", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const old = await createShortLink(tx, KEY, {
        tenantId: f.tenantId,
        visitId: f.visitId,
        purpose: "manage",
        expiresAt: new Date(EARLY.getTime() - 60_000),
      });
      const result = await rescheduleByLink(f.deps(), f.code, {
        start: MONDAY,
        mechanicId: f.mechanicId,
      });
      expect(result.visit.start).toBe(MONDAY.toISOString());

      const [row] = await tx
        .select({ start: visit.timeWindow })
        .from(visit)
        .where(eq(visit.id, f.visitId));
      expect(row?.start).toContain("2027-04-19 06:00:00");
      const [event] = await tx
        .select()
        .from(domainEvent)
        .where(
          and(eq(domainEvent.aggregateId, f.visitId), eq(domainEvent.type, "visit.reschedule")),
        );
      expect(event).toMatchObject({ actorType: "customer", actorId: f.customerId });

      expect(await managePage(f.deps(), f.code)).toMatchObject({ state: "used" });
      // A link that had already expired still says so, not that it was used.
      expect(await managePage(f.deps(), old)).toMatchObject({ state: "expired" });
      expect(
        await errorCode(
          rescheduleByLink(f.deps(), f.code, { start: MONDAY, mechanicId: f.mechanicId }),
        ),
      ).toBe("link_used");
      expect(await errorCode(cancelByLink(f.deps(), f.code))).toBe("link_used");
    });
  });

  it("cancel as the customer and use up the link", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const result = await cancelByLink(f.deps(), f.code);
      expect(result.visit.status).toBe("cancelled");
      expect(await managePage(f.deps(), f.code)).toMatchObject({ state: "used" });
    });
  });

  it("refuse an expired link for every change", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const kms = createLocalKms(randomBytes(32));
      expect(await errorCode(cancelByLink(f.deps(START), f.code))).toBe("link_expired");
      expect(
        await errorCode(saveAccessByLink({ ...f.deps(START), kms }, f.code, { code: "1234" })),
      ).toBe("link_expired");
    });
  });

  it("save access information encrypted, without using up the link", async () => {
    await withRollback(async (tx) => {
      const f = await setup(tx);
      const kms = createLocalKms(randomBytes(32));
      await saveAccessByLink({ ...f.deps(), kms }, f.code, {
        code: " 4711# ",
        keyLocation: "Under fendern",
      });
      const [row] = await tx.select().from(accessInfo).where(eq(accessInfo.boatId, f.boatId));
      expect(row?.codeEncrypted).toBeTruthy();
      expect(row?.codeEncrypted?.toString("latin1")).not.toContain("4711");
      const [t] = await tx
        .select({ wrapped: tenant.dataKeyEncrypted })
        .from(tenant)
        .where(eq(tenant.id, f.tenantId));
      const dataKey = await kms.decryptDataKey(f.tenantId, t!.wrapped!);
      expect(
        decryptField(dataKey, row!.codeEncrypted!, fieldAad(f.tenantId, "access_info.code")),
      ).toBe("4711#");

      // An empty field keeps what is stored; the link still works.
      await saveAccessByLink({ ...f.deps(), kms }, f.code, { keyLocation: "I kapellet" });
      const [after] = await tx.select().from(accessInfo).where(eq(accessInfo.boatId, f.boatId));
      expect(after?.codeEncrypted).toEqual(row?.codeEncrypted);
      expect(await managePage(f.deps(), f.code)).toMatchObject({ state: "valid", hasAccess: true });

      expect(await errorCode(saveAccessByLink({ ...f.deps(), kms }, f.code, { code: "  " }))).toBe(
        "invalid_input",
      );
      expect(
        await errorCode(saveAccessByLink({ ...f.deps(), kms }, f.code, { code: "x".repeat(201) })),
      ).toBe("invalid_input");
    });
  });
});
