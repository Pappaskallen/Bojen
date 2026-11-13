/**
 * The only way to write or read access codes and key locations (byggplan step 1.6).
 *
 * Codes are encrypted with the firm's data key (AES-256-GCM, packages/core/src/crypto)
 * before they reach the database, and decrypted only for the mechanic who has the visit,
 * within 12 hours of its start, or for the owner. Every attempt is written to
 * `audit_log`, allowed or not. Plaintext is returned as `Secret`, which prints as
 * `[redacted]`, and never appears in errors, logs or the audit log.
 *
 * Callers must not roll back the transaction after a refused attempt; the audit row is
 * the point of it.
 */
import {
  type AccessDecision,
  type EncryptedField,
  type Kms,
  Secret,
  decideAccess,
  decideBoatAccess,
  decryptField,
  encryptField,
  fieldAad,
} from "@bojen/core/crypto";
import { stockholmDate } from "@bojen/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { placementOn } from "./queries/location";
import {
  accessInfo,
  appUser,
  auditLog,
  boat,
  job,
  locationAccessRule,
  tenant,
  visit,
} from "./schema";

type Executor = Pick<Database, "select" | "insert" | "update">;

export interface AccessDeps {
  db: Executor;
  kms: Kms;
  now: () => Date;
}

export type AccessDeniedReason =
  | Extract<AccessDecision, { allowed: false }>["reason"]
  | "unknown_user"
  | "visit_not_found"
  | "boat_not_found";

export class AccessDeniedError extends Error {
  constructor(readonly reason: AccessDeniedReason) {
    super(`Access to the code was refused: ${reason}`);
    this.name = "AccessDeniedError";
  }
}

/** The firm's data key in plaintext. Creates and stores a wrapped key on first use. */
async function dataKey(deps: Pick<AccessDeps, "db" | "kms">, tenantId: string): Promise<Buffer> {
  const { db, kms } = deps;
  const [row] = await db
    .select({ wrapped: tenant.dataKeyEncrypted })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!row) throw new Error("Unknown tenant");
  if (row.wrapped) return kms.decryptDataKey(tenantId, row.wrapped);

  const created = await kms.generateDataKey(tenantId);
  const stored = await db
    .update(tenant)
    .set({ dataKeyEncrypted: created.encrypted })
    .where(and(eq(tenant.id, tenantId), isNull(tenant.dataKeyEncrypted)))
    .returning({ id: tenant.id });
  if (stored.length === 1) return created.plaintext;

  // Another request stored a key first; use that one.
  return dataKey(deps, tenantId);
}

function seal(key: Buffer, tenantId: string, field: EncryptedField, value: string | undefined) {
  return value === undefined ? undefined : encryptField(key, value, fieldAad(tenantId, field));
}

function open(key: Buffer, tenantId: string, field: EncryptedField, stored: Buffer | null) {
  return stored ? new Secret(decryptField(key, stored, fieldAad(tenantId, field))) : null;
}

export interface AccessInput {
  tenantId: string;
  boatId: string;
  code?: string;
  keyLocation?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  validUntil?: string | null;
}

/** Saves a boat's access information, encrypting the code and key location. */
export async function encryptAccess(deps: AccessDeps, input: AccessInput): Promise<{ id: string }> {
  const { tenantId, boatId } = input;
  const key = await dataKey(deps, tenantId);
  const values = {
    codeEncrypted: seal(key, tenantId, "access_info.code", input.code),
    keyLocationEncrypted: seal(key, tenantId, "access_info.key_location", input.keyLocation),
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    validUntil: input.validUntil,
  };
  const changes = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));

  const [existing] = await deps.db
    .select({ id: accessInfo.id })
    .from(accessInfo)
    .where(
      and(
        eq(accessInfo.tenantId, tenantId),
        eq(accessInfo.boatId, boatId),
        isNull(accessInfo.deletedAt),
      ),
    );
  if (existing) {
    await deps.db.update(accessInfo).set(changes).where(eq(accessInfo.id, existing.id));
    return existing;
  }
  const [created] = await deps.db
    .insert(accessInfo)
    .values({ tenantId, boatId, ...changes })
    .returning({ id: accessInfo.id });
  if (!created) throw new Error("access_info not created");
  return created;
}

export interface LocationAccessInput {
  tenantId: string;
  locationId: string;
  gateCode?: string;
  keyBox?: string;
}

/** Saves a marina's gate code and key box code, encrypted. */
export async function encryptLocationAccess(
  deps: AccessDeps,
  input: LocationAccessInput,
): Promise<{ id: string }> {
  const { tenantId, locationId } = input;
  const key = await dataKey(deps, tenantId);
  const changes = Object.fromEntries(
    Object.entries({
      gateCodeEncrypted: seal(key, tenantId, "location_access_rule.gate_code", input.gateCode),
      keyBoxEncrypted: seal(key, tenantId, "location_access_rule.key_box", input.keyBox),
    }).filter(([, v]) => v !== undefined),
  );

  const [existing] = await deps.db
    .select({ id: locationAccessRule.id })
    .from(locationAccessRule)
    .where(
      and(
        eq(locationAccessRule.tenantId, tenantId),
        eq(locationAccessRule.locationId, locationId),
        isNull(locationAccessRule.deletedAt),
      ),
    );
  if (existing) {
    await deps.db
      .update(locationAccessRule)
      .set(changes)
      .where(eq(locationAccessRule.id, existing.id));
    return existing;
  }
  const [created] = await deps.db
    .insert(locationAccessRule)
    .values({ tenantId, locationId, ...changes })
    .returning({ id: locationAccessRule.id });
  if (!created) throw new Error("location_access_rule not created");
  return created;
}

export interface RevealedAccess {
  code: Secret | null;
  keyLocation: Secret | null;
  gateCode: Secret | null;
  keyBox: Secret | null;
  contactName: string | null;
  contactPhone: string | null;
}

/**
 * Decrypts the access information for a visit: the boat's code and key location, and
 * the gate code and key box at the place where the boat is on the day of the visit.
 * Throws `AccessDeniedError` when the rule refuses; the attempt is logged either way.
 */
export async function decryptAccess(
  deps: AccessDeps,
  userId: string,
  visitId: string,
): Promise<RevealedAccess> {
  const { db } = deps;
  const [user] = await db
    .select({ id: appUser.id, tenantId: appUser.tenantId, role: appUser.role })
    .from(appUser)
    .where(and(eq(appUser.id, userId), isNull(appUser.deletedAt)));
  if (!user) throw new AccessDeniedError("unknown_user");

  const log = (action: "access_code_viewed" | "access_code_denied", reason: string) =>
    db.insert(auditLog).values({
      tenantId: user.tenantId,
      userId: user.id,
      action,
      subjectType: "visit",
      subjectId: visitId,
      details: { reason },
    });

  const [found] = await db
    .select({
      mechanicId: visit.mechanicId,
      boatId: job.boatId,
      startEpoch: sql<string>`extract(epoch from lower(${visit.timeWindow}))`,
    })
    .from(visit)
    .innerJoin(job, eq(job.id, visit.jobId))
    .where(and(eq(visit.id, visitId), eq(visit.tenantId, user.tenantId), isNull(visit.deletedAt)));
  if (!found) {
    await log("access_code_denied", "visit_not_found");
    throw new AccessDeniedError("visit_not_found");
  }

  const start = new Date(Number(found.startEpoch) * 1000);
  const decision = decideAccess({
    userId: user.id,
    role: user.role,
    visit: { mechanicId: found.mechanicId, start },
    now: deps.now(),
  });
  if (!decision.allowed) {
    await log("access_code_denied", decision.reason);
    throw new AccessDeniedError(decision.reason);
  }
  await log("access_code_viewed", decision.reason);

  return openAccess(deps, user.tenantId, found.boatId, stockholmDate(start));
}

/**
 * The boat's code and key location, and the gate code and key box where the boat is on
 * `day`. Only after the rule has allowed it and the attempt is logged.
 */
async function openAccess(
  deps: AccessDeps,
  tenantId: string,
  boatId: string | null,
  day: string,
): Promise<RevealedAccess> {
  const { db } = deps;
  const key = await dataKey(deps, tenantId);
  const [info] = boatId
    ? await db
        .select()
        .from(accessInfo)
        .where(
          and(
            eq(accessInfo.tenantId, tenantId),
            eq(accessInfo.boatId, boatId),
            isNull(accessInfo.deletedAt),
          ),
        )
    : [];

  const placement = boatId ? await placementOn(db, boatId, day) : undefined;
  const [rule] = placement
    ? await db
        .select()
        .from(locationAccessRule)
        .where(
          and(
            eq(locationAccessRule.tenantId, tenantId),
            eq(locationAccessRule.locationId, placement.location.id),
            isNull(locationAccessRule.deletedAt),
          ),
        )
    : [];

  return {
    code: open(key, tenantId, "access_info.code", info?.codeEncrypted ?? null),
    keyLocation: open(
      key,
      tenantId,
      "access_info.key_location",
      info?.keyLocationEncrypted ?? null,
    ),
    gateCode: open(
      key,
      tenantId,
      "location_access_rule.gate_code",
      rule?.gateCodeEncrypted ?? null,
    ),
    keyBox: open(key, tenantId, "location_access_rule.key_box", rule?.keyBoxEncrypted ?? null),
    contactName: info?.contactName ?? null,
    contactPhone: info?.contactPhone ?? null,
  };
}

/**
 * The access information from the boat card (step 5.2): for the owner at any time, for a
 * mechanic only through their own visit to the boat within 12 hours of its start. Every
 * attempt is written to `audit_log` against the boat, allowed or not, with the visit it went
 * through. Throws `AccessDeniedError` when the rule refuses.
 */
export async function revealBoatAccess(
  deps: AccessDeps,
  userId: string,
  boatId: string,
): Promise<RevealedAccess> {
  const { db } = deps;
  const [user] = await db
    .select({ id: appUser.id, tenantId: appUser.tenantId, role: appUser.role })
    .from(appUser)
    .where(and(eq(appUser.id, userId), isNull(appUser.deletedAt)));
  if (!user) throw new AccessDeniedError("unknown_user");

  const log = (
    action: "access_code_viewed" | "access_code_denied",
    reason: string,
    visitId: string | null = null,
  ) =>
    db.insert(auditLog).values({
      tenantId: user.tenantId,
      userId: user.id,
      action,
      subjectType: "boat",
      subjectId: boatId,
      details: visitId ? { reason, visitId } : { reason },
    });

  const [found] = await db
    .select({ id: boat.id })
    .from(boat)
    .where(and(eq(boat.tenantId, user.tenantId), eq(boat.id, boatId), isNull(boat.deletedAt)));
  if (!found) {
    await log("access_code_denied", "boat_not_found");
    throw new AccessDeniedError("boat_not_found");
  }

  const visits = await db
    .select({
      id: visit.id,
      mechanicId: visit.mechanicId,
      startEpoch: sql<string>`extract(epoch from lower(${visit.timeWindow}))`,
    })
    .from(visit)
    .innerJoin(job, and(eq(job.tenantId, visit.tenantId), eq(job.id, visit.jobId)))
    .where(
      and(
        eq(visit.tenantId, user.tenantId),
        eq(job.boatId, boatId),
        isNull(visit.deletedAt),
        sql`${visit.status} not in ('cancelled', 'done', 'no_access')`,
      ),
    );
  const now = deps.now();
  const decision = decideBoatAccess({
    userId: user.id,
    role: user.role,
    visits: visits.map((v) => ({
      id: v.id,
      mechanicId: v.mechanicId,
      start: new Date(Number(v.startEpoch) * 1000),
    })),
    now,
  });
  if (!decision.allowed) {
    await log("access_code_denied", decision.reason);
    throw new AccessDeniedError(decision.reason);
  }
  await log("access_code_viewed", decision.reason, decision.visitId);

  const through = visits.find((v) => v.id === decision.visitId);
  const day = stockholmDate(through ? new Date(Number(through.startEpoch) * 1000) : now);
  return openAccess(deps, user.tenantId, boatId, day);
}
