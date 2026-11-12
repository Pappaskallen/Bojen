import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { distanceBetweenLocations, placementOn } from "../src/queries/location";
import { appUser, boat, customer, location, visit } from "../src/schema";
import {
  DEMO_TENANT_ID,
  OTHER_TENANT_ID,
  fictionalMobile,
  seedDemoData,
  seedOtherTenant,
  truncateAll,
} from "../src/seed";
import { asTenantUser, closeDb, withRollback } from "./helpers";

afterAll(closeDb);

describe("demo data (step 1.5)", () => {
  it("uses only the PTS range for fictional mobile numbers", () => {
    expect(fictionalMobile(0)).toBe("+46701740605");
    expect(fictionalMobile(94)).toBe("+46701740699");
    expect(() => fictionalMobile(95)).toThrow();
  });

  it("seeds Jonas Båtservice with marinas, 40 customers, 45 boats and last season", async () => {
    await withRollback(async (tx) => {
      // TRUNCATE is transactional, so a seeded local database comes back after the test.
      await truncateAll(tx);
      const result = await seedDemoData(tx);
      await seedOtherTenant(tx);
      expect(result).toMatchObject({ customers: 40, boats: 45 });

      const mechanics = await tx
        .select({ name: appUser.name })
        .from(appUser)
        .where(eq(appUser.tenantId, DEMO_TENANT_ID));
      expect(mechanics).toHaveLength(2);

      const privateCustomers = await tx
        .select({ id: customer.id })
        .from(customer)
        .where(and(eq(customer.tenantId, DEMO_TENANT_ID), eq(customer.type, "private")));
      expect(privateCustomers).toHaveLength(40);

      const boats = await tx
        .select({ make: boat.make })
        .from(boat)
        .where(eq(boat.tenantId, DEMO_TENANT_ID));
      expect(boats).toHaveLength(45);
      expect(new Set(boats.map((b) => b.make)).size).toBeGreaterThanOrEqual(10);

      const marinas = await tx
        .select({ id: location.id, name: location.name })
        .from(location)
        .where(eq(location.tenantId, DEMO_TENANT_ID));
      expect(marinas.map((l) => l.name).sort()).toEqual([
        "Bullandö Marina",
        "Djurö Båtvarv",
        "Saltsjöbadens Båtklubb",
        "Sandhamns gästhamn",
      ]);
      const byName = Object.fromEntries(marinas.map((l) => [l.name, l.id]));
      const bullandoToSandhamn = await distanceBetweenLocations(
        tx,
        byName["Bullandö Marina"]!,
        byName["Sandhamns gästhamn"]!,
      );
      expect(bullandoToSandhamn).toBeGreaterThan(13_000);
      expect(bullandoToSandhamn).toBeLessThan(17_000);

      // Last season: a spring service for every boat, and a lay-up for most of them.
      const [season] = await tx.execute<{ spring: number; autumn: number }>(sql`
        select
          count(*) filter (where lower(time_window) < '2026-07-01')::int as spring,
          count(*) filter (where lower(time_window) >= '2026-07-01')::int as autumn
        from ${visit}
        where tenant_id = ${DEMO_TENANT_ID} and status = 'done'
      `);
      expect(season!.spring).toBe(45);
      expect(season!.autumn).toBeGreaterThan(20);

      // Every boat is somewhere in July and somewhere else (on land) in January.
      const [firstBoat] = await tx
        .select({ id: boat.id })
        .from(boat)
        .where(eq(boat.tenantId, DEMO_TENANT_ID))
        .limit(1);
      expect((await placementOn(tx, firstBoat!.id, "2026-07-15"))?.placement.mode).toBe("water");
      expect((await placementOn(tx, firstBoat!.id, "2027-01-15"))?.placement.season).toBe("winter");

      // Signed in as the second firm, none of the demo firm's customers are visible.
      await asTenantUser(tx, OTHER_TENANT_ID);
      const visible = await tx.select({ tenantId: customer.tenantId }).from(customer);
      expect(visible.map((c) => c.tenantId)).toEqual([OTHER_TENANT_ID]);
    });
    // Seeding writes thousands of rows; on a busy machine it takes more than the default 5 s.
  }, 30_000);
});
