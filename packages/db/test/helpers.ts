import { sql } from "drizzle-orm";
import { connect, type Database } from "../src/client";
import {
  appUser,
  boat,
  boatOwnership,
  customer,
  drive,
  engine,
  engineHoursReading,
  tenant,
} from "../src/schema";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

class Rollback extends Error {}

const connection = connect();
export const db = connection.db;
export const closeDb = connection.close;

/** Runs `fn` in a transaction that is always rolled back, so tests leave no rows behind. */
export async function withRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/**
 * Switches the rest of the transaction to the `authenticated` role with a JWT
 * carrying `tenant_id`, exactly as Supabase does for a signed-in user.
 */
export async function asTenantUser(tx: Tx, tenantId: string): Promise<void> {
  const claims = JSON.stringify({
    sub: crypto.randomUUID(),
    role: "authenticated",
    tenant_id: tenantId,
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role authenticated`);
}

/** Expects the statement to fail with a Postgres error. Uses a savepoint so the transaction survives. */
export async function expectDbError(tx: Tx, fn: (tx: Tx) => Promise<unknown>): Promise<Error> {
  try {
    await tx.transaction(async (savepoint) => {
      await fn(savepoint);
    });
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected the database to reject the statement");
}

/** Inserts one row in every core table for a new tenant. Runs as the owner (bypasses RLS). */
export async function createTenantWithBoat(tx: Tx, name: string, phone: string) {
  const [t] = await tx.insert(tenant).values({ name }).returning();
  if (!t) throw new Error("tenant not created");
  const tenantId = t.id;

  await tx.insert(appUser).values({ tenantId, name: `${name} mekaniker`, role: "mechanic" });
  const [c] = await tx
    .insert(customer)
    .values({ tenantId, name: `${name} kund`, phone })
    .returning();
  const [b] = await tx
    .insert(boat)
    .values({ tenantId, name: `${name} båt` })
    .returning();
  if (!c || !b) throw new Error("customer or boat not created");

  await tx.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: c.id });
  const [e] = await tx.insert(engine).values({ tenantId, boatId: b.id }).returning();
  if (!e) throw new Error("engine not created");
  await tx.insert(drive).values({ tenantId, engineId: e.id, type: "DPH" });
  await tx
    .insert(engineHoursReading)
    .values({ tenantId, engineId: e.id, hours: "412.5", readAt: new Date(), source: "mechanic" });

  return { tenantId, customerId: c.id, boatId: b.id, engineId: e.id };
}
