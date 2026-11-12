import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  asTenantUser,
  closeDb,
  createTenantWithBoat,
  db,
  expectDbError,
  withRollback,
  type Tx,
} from "./helpers";

afterAll(closeDb);

/** Tables where signed-in users may only read and add rows; updates find nothing. */
const APPEND_ONLY = new Set(["audit_log", "domain_event"]);

interface TableInfo {
  table: string;
  rls: boolean;
  tenantColumn: string | null;
  /** Columns that can be written (not generated). */
  writable: string[];
}

/** Every table in the public schema, with the column that holds its tenant. */
async function publicTables(): Promise<TableInfo[]> {
  const rows = await db.execute<{
    table_name: string;
    rls: boolean;
    has_tenant_id: boolean;
    writable: string[];
  }>(sql`
    select c.relname as table_name,
           c.relrowsecurity as rls,
           exists (
             select 1 from information_schema.columns col
             where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id'
           ) as has_tenant_id,
           array(
             select col.column_name::text from information_schema.columns col
             where col.table_schema = 'public' and col.table_name = c.relname
               and col.is_generated = 'NEVER' and col.column_name <> 'id'
             order by col.ordinal_position
           ) as writable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `);
  return rows.map((r) => ({
    table: r.table_name,
    rls: r.rls,
    tenantColumn: r.table_name === "tenant" ? "id" : r.has_tenant_id ? "tenant_id" : null,
    writable: r.writable,
  }));
}

/** One of tenant A's rows per table, read as the owner, so B can try to write a copy. */
async function oneRowPerTable(tx: Tx, tables: TableInfo[], tenantId: string) {
  const rows = new Map<string, unknown>();
  for (const { table, tenantColumn } of tables) {
    const [row] = await tx.execute<{ row: unknown }>(
      sql`select to_jsonb(t) as row from ${sql.identifier(table)} t where ${sql.identifier(tenantColumn!)} = ${tenantId} limit 1`,
    );
    rows.set(table, row!.row);
  }
  return rows;
}

function columnList(columns: string[]) {
  return sql.join(
    columns.map((c) => sql.identifier(c)),
    sql`, `,
  );
}

const count = (tx: Tx, table: string) =>
  tx
    .execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`)
    .then(([r]) => r!.n);

describe("tenant isolation", () => {
  it("has Row Level Security and a tenant column on every table", async () => {
    const tables = await publicTables();
    expect(tables.length).toBeGreaterThanOrEqual(40);
    for (const t of tables) {
      expect({ table: t.table, rls: t.rls }).toEqual({ table: t.table, rls: true });
      expect({ table: t.table, tenantColumn: t.tenantColumn }).not.toEqual({
        table: t.table,
        tenantColumn: null,
      });
    }
  });

  it("stops tenant B from reading, writing or deleting tenant A's rows in every table", async () => {
    const tables = await publicTables();
    await withRollback(async (tx) => {
      const a = await createTenantWithBoat(tx, "A", "+46700000001");
      const b = await createTenantWithBoat(tx, "B", "+46700000002");

      // Sanity check as the owner: tenant A has rows in every table. B has as many.
      const rowsPerTable = new Map<string, number>();
      for (const { table, tenantColumn } of tables) {
        const [row] = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(tenantColumn!)} = ${a.tenantId}`,
        );
        expect({ table, hasRows: row!.n > 0 }).toEqual({ table, hasRows: true });
        rowsPerTable.set(table, row!.n);
      }
      const copies = await oneRowPerTable(tx, tables, a.tenantId);

      await asTenantUser(tx, b.tenantId);

      for (const { table, tenantColumn, writable } of tables) {
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
          visibleOwn: rowsPerTable.get(table),
          updated: 0,
          deleted: 0,
        });

        // Writing a copy of A's row, still marked as A's, is refused.
        const insertError = await expectDbError(tx, (sp) =>
          sp.execute(sql`
            insert into ${tbl} (${columnList(writable)})
            select ${columnList(writable)}
            from jsonb_populate_record(null::${tbl}, ${JSON.stringify(copies.get(table))}::jsonb)
          `),
        );
        expect({ table, error: String(insertError.cause ?? insertError) }).toMatchObject({
          table,
          error: expect.stringMatching(/row-level security/),
        });

        // Moving B's own row over to A is refused too. The audit log allows no updates at
        // all, so there the row is simply not found.
        if (APPEND_ONLY.has(table)) {
          const moved = await tx.execute(
            sql`update ${tbl} set ${col} = ${a.tenantId} where ${col} = ${b.tenantId} returning 1`,
          );
          expect({ table, moved: moved.length }).toEqual({ table, moved: 0 });
        } else {
          const moveError = await expectDbError(tx, (sp) =>
            sp.execute(sql`update ${tbl} set ${col} = ${a.tenantId} where ${col} = ${b.tenantId}`),
          );
          expect({ table, error: String(moveError.cause ?? moveError) }).toMatchObject({
            table,
            error: expect.stringMatching(/row-level security/),
          });
        }
      }
    });
  });

  it("shows nothing to visitors who are not signed in or have no tenant", async () => {
    const tables = await publicTables();
    await withRollback(async (tx) => {
      await createTenantWithBoat(tx, "A", "+46700000001");

      await tx.execute(sql`set local role anon`);
      for (const { table } of tables) {
        expect({ table, anon: await count(tx, table) }).toEqual({ table, anon: 0 });
      }
    });

    await withRollback(async (tx) => {
      await createTenantWithBoat(tx, "A", "+46700000001");

      const claims = JSON.stringify({ sub: crypto.randomUUID(), role: "authenticated" });
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      await tx.execute(sql`set local role authenticated`);
      for (const { table } of tables) {
        expect({ table, noTenant: await count(tx, table) }).toEqual({ table, noTenant: 0 });
      }
    });
  });
});
