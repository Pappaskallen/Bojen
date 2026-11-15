/**
 * Staff passkeys (byggplan step 5.5c, spec 10.7). This file only stores and finds them; the
 * WebAuthn checks themselves are done by the web app with SimpleWebAuthn before anything here
 * is called.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { appUser, staffPasskey } from "./schema";

type Db = Pick<Database, "select" | "insert" | "update">;

export interface StoredPasskey {
  id: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  prf: boolean;
  name: string | null;
}

export async function addPasskey(
  db: Db,
  owner: { tenantId: string; appUserId: string },
  passkey: Omit<StoredPasskey, "id">,
): Promise<string> {
  const [row] = await db
    .insert(staffPasskey)
    .values({
      tenantId: owner.tenantId,
      appUserId: owner.appUserId,
      credentialId: passkey.credentialId,
      publicKey: Buffer.from(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports,
      prf: passkey.prf,
      name: passkey.name,
    })
    .returning({ id: staffPasskey.id });
  if (!row) throw new Error("passkey not stored");
  return row.id;
}

/** The person's passkeys, oldest first. */
export async function passkeysOf(
  db: Db,
  tenantId: string,
  appUserId: string,
): Promise<StoredPasskey[]> {
  const rows = await db
    .select()
    .from(staffPasskey)
    .where(
      and(
        eq(staffPasskey.tenantId, tenantId),
        eq(staffPasskey.appUserId, appUserId),
        isNull(staffPasskey.deletedAt),
      ),
    )
    .orderBy(asc(staffPasskey.createdAt));
  return rows.map((r) => ({
    id: r.id,
    credentialId: r.credentialId,
    publicKey: new Uint8Array(r.publicKey),
    counter: r.counter,
    transports: r.transports ?? [],
    prf: r.prf,
    name: r.name,
  }));
}

export interface PasskeyOwner {
  passkey: StoredPasskey;
  tenantId: string;
  appUserId: string;
  email: string;
}

/**
 * Who a passkey belongs to, from the id the browser sends at sign-in. Only staff who are still
 * there and have an e-mail can sign in.
 */
export async function passkeyOwner(db: Db, credentialId: string): Promise<PasskeyOwner | null> {
  const [row] = await db
    .select({ passkey: staffPasskey, email: appUser.email })
    .from(staffPasskey)
    .innerJoin(
      appUser,
      and(
        eq(appUser.tenantId, staffPasskey.tenantId),
        eq(appUser.id, staffPasskey.appUserId),
        isNull(appUser.deletedAt),
      ),
    )
    .where(and(eq(staffPasskey.credentialId, credentialId), isNull(staffPasskey.deletedAt)));
  if (!row?.email) return null;
  const p = row.passkey;
  return {
    tenantId: p.tenantId,
    appUserId: p.appUserId,
    email: row.email,
    passkey: {
      id: p.id,
      credentialId: p.credentialId,
      publicKey: new Uint8Array(p.publicKey),
      counter: p.counter,
      transports: p.transports ?? [],
      prf: p.prf,
      name: p.name,
    },
  };
}

/** After a sign-in: the new counter and when it was used. */
export async function passkeyUsed(db: Db, passkeyId: string, counter: number, at: Date) {
  await db
    .update(staffPasskey)
    .set({ counter: sql`greatest(${staffPasskey.counter}, ${counter})`, lastUsedAt: at })
    .where(eq(staffPasskey.id, passkeyId));
}
