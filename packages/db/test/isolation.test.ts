import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { boat, customer } from "../src/schema";
import {
  asTenantUser,
  closeDb,
  createTenantWithBoat,
  db,
  expectDbError,
  withRollback,
} from "./helpers";

afterAll(closeDb);

/** Every table in the public schema, with the column that holds its tenant. */
async function publicTables() {
  const rows = await db.execute<{ table_name: string; rls: boolean; has_tenant_id: boolean }>(sql`
    select c.relname as table_name,
           c.relrowsecurity as rls,
           exists (
             select 1 from information_schema.columns col
             where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id'
           ) as has_tenant_id
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  return rows.map((r) => ({
    table: r.table_name,
    rls: r.rls,
    tenantColumn: r.table_name === "tenant" ? "id" : r.has_tenant_id ? "tenant_id" : null,
  }));
}

describe("tenant isolation", () => {
  it("has Row Level Security and a tenant column on every table", async () => {
    const tables = await publicTables();
    expect(tables.length).toBeGreaterThanOrEqual(30);
    for (const t of tables) {
      expect({ table: t.table, rls: t.rls }).toEqual({ table: t.table, rls: true });
      expect({ table: t.table, tenantColumn: t.tenantColumn }).not.toEqual({
        table: t.table,
        tenantColumn: null,
      });
    }
  });

  it("stops tenant B from reading, changing or deleting tenant A's rows in every table", async () => {
    const tables = await publicTables();
    await withRollback(async (tx) => {
      const a = await createTenantWithBoat(tx, "A", "+46700000001");
      const b = await createTenantWithBoat(tx, "B", "+46700000002");

      // Sanity check as the owner: tenant A has rows in every table.
      for (const { table, tenantColumn } of tables) {
        const [row] = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(tenantColumn!)} = ${a.tenantId}`,
        );
        expect({ table, n: row!.n }).toEqual({ table, n: 1 });
      }

      await asTenantUser(tx, b.tenantId);

      for (const { table, tenantColumn } of tables) {
        const col = sql.identifier(tenantColumn!);
        const tbl = sql.identifier(table);

        const [visibleA] = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${tbl} where ${col} = ${a.tenantId}`,
        );
        const [visibleOwn] = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${tbl} where ${col} = ${b.tenantId}`,
        );
        const updated = await tx.execute(
          sql`update ${tbl} set ${col} = ${col} where ${col} = ${a.tenantId} returning 1`,
        );
        const deleted = await tx.execute(
          sql`delete from ${tbl} where ${col} = ${a.tenantId} returning 1`,
        );

        expect({
          table,
          visibleA: visibleA!.n,
          visibleOwn: visibleOwn!.n,
          updated: updated.length,
          deleted: deleted.length,
        }).toEqual({
          table,
          visibleA: 0,
          visibleOwn: 1,
          updated: 0,
          deleted: 0,
        });
      }

      // Writing a row that claims to belong to tenant A is refused.
      const customerError = await expectDbError(tx, (sp) =>
        sp.insert(customer).values({ tenantId: a.tenantId, name: "Inkräktare" }),
      );
      expect(String(customerError.cause ?? customerError)).toMatch(/row-level security/);

      const boatError = await expectDbError(tx, (sp) =>
        sp.insert(boat).values({ tenantId: a.tenantId }),
      );
      expect(String(boatError.cause ?? boatError)).toMatch(/row-level security/);
    });
  });
});
