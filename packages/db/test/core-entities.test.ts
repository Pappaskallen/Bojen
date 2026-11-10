import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { boat, boatOwnership, customer, engine, tenant } from "../src/schema";
import { closeDb, createTenantWithBoat, expectDbError, withRollback } from "./helpers";

afterAll(closeDb);

describe("core entities (step 1.1)", () => {
  it("stores a customer with two boats and a boat with two co-owners", async () => {
    await withRollback(async (tx) => {
      const [firm] = await tx.insert(tenant).values({ name: "Jonas Båtservice" }).returning();
      const tenantId = firm!.id;

      const [anna, bertil] = await tx
        .insert(customer)
        .values([
          { tenantId, name: "Anna Ek", phone: "+46701234567" },
          { tenantId, name: "Bertil Ek", phone: "+46707654321" },
        ])
        .returning();
      const [daycruiser, sailboat] = await tx
        .insert(boat)
        .values([
          { tenantId, name: "Solvik", make: "Nimbus", model: "305 Coupé" },
          { tenantId, name: "Vinga", make: "Hallberg-Rassy", model: "31" },
        ])
        .returning();

      await tx.insert(boatOwnership).values([
        { tenantId, customerId: anna!.id, boatId: daycruiser!.id, role: "owner" },
        { tenantId, customerId: anna!.id, boatId: sailboat!.id, role: "co_owner" },
        { tenantId, customerId: bertil!.id, boatId: sailboat!.id, role: "co_owner" },
      ]);

      const annasBoats = await tx
        .select({ name: boat.name })
        .from(boatOwnership)
        .innerJoin(boat, eq(boat.id, boatOwnership.boatId))
        .where(and(eq(boatOwnership.customerId, anna!.id), isNull(boatOwnership.deletedAt)));
      expect(annasBoats.map((b) => b.name).sort()).toEqual(["Solvik", "Vinga"]);

      const vingaOwners = await tx
        .select({ name: customer.name, role: boatOwnership.role })
        .from(boatOwnership)
        .innerJoin(customer, eq(customer.id, boatOwnership.customerId))
        .where(eq(boatOwnership.boatId, sailboat!.id));
      expect(vingaOwners).toHaveLength(2);
      expect(vingaOwners.every((o) => o.role === "co_owner")).toBe(true);
    });
  });

  it("rejects phone numbers that are not E.164", async () => {
    await withRollback(async (tx) => {
      const [firm] = await tx.insert(tenant).values({ name: "Firma" }).returning();
      const error = await expectDbError(tx, (sp) =>
        sp.insert(customer).values({ tenantId: firm!.id, name: "Fel", phone: "070-123 45 67" }),
      );
      expect(String(error.cause ?? error)).toMatch(/customer_phone_e164/);
    });
  });

  it("keeps phone numbers unique per tenant but allows the same number in another tenant", async () => {
    await withRollback(async (tx) => {
      const a = await createTenantWithBoat(tx, "A", "+46700000001");
      const b = await createTenantWithBoat(tx, "B", "+46700000001");
      expect(a.tenantId).not.toBe(b.tenantId);

      const error = await expectDbError(tx, (sp) =>
        sp
          .insert(customer)
          .values({ tenantId: a.tenantId, name: "Dubblett", phone: "+46700000001" }),
      );
      expect(String(error.cause ?? error)).toMatch(/customer_tenant_id_phone_key/);
    });
  });

  it("refuses links between rows of different tenants", async () => {
    await withRollback(async (tx) => {
      const a = await createTenantWithBoat(tx, "A", "+46700000001");
      const b = await createTenantWithBoat(tx, "B", "+46700000002");

      const ownership = await expectDbError(tx, (sp) =>
        sp
          .insert(boatOwnership)
          .values({ tenantId: a.tenantId, boatId: b.boatId, customerId: a.customerId }),
      );
      expect(String(ownership.cause ?? ownership)).toMatch(/boat_ownership_boat_fk/);

      const engineOnForeignBoat = await expectDbError(tx, (sp) =>
        sp.insert(engine).values({ tenantId: a.tenantId, boatId: b.boatId }),
      );
      expect(String(engineOnForeignBoat.cause ?? engineOnForeignBoat)).toMatch(/engine_boat_fk/);
    });
  });
});
