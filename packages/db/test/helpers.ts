import { sql } from "drizzle-orm";
import { connect, type Database } from "../src/client";
import {
  accessInfo,
  appUser,
  area,
  auditLog,
  boat,
  boatOwnership,
  boatPlacement,
  call,
  campaign,
  campaignRecipient,
  consent,
  customer,
  drive,
  engine,
  engineHoursReading,
  job,
  jobLine,
  jobPart,
  kpiSnapshot,
  location,
  locationAccessRule,
  message,
  part,
  serviceType,
  supplier,
  survey,
  task,
  tenant,
  visit,
  waitlistEntry,
  scheduleBlock,
  travelCache,
  workSchedule,
} from "../src/schema";
import { timeRange } from "../src/schema/_types";

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

/** Inserts one row in every table for a new tenant. Runs as the owner (bypasses RLS). */
export async function createTenantWithBoat(tx: Tx, name: string, phone: string) {
  const [t] = await tx.insert(tenant).values({ name }).returning();
  if (!t) throw new Error("tenant not created");
  const tenantId = t.id;

  const [mechanic] = await tx
    .insert(appUser)
    .values({ tenantId, name: `${name} mekaniker`, role: "mechanic" })
    .returning();
  if (!mechanic) throw new Error("app_user not created");
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

  const [a] = await tx
    .insert(area)
    .values({
      tenantId,
      name: `${name} område`,
      boundary: [
        [
          { lng: 18.6, lat: 59.2 },
          { lng: 19.0, lat: 59.2 },
          { lng: 19.0, lat: 59.4 },
          { lng: 18.6, lat: 59.4 },
          { lng: 18.6, lat: 59.2 },
        ],
      ],
    })
    .returning();
  if (!a) throw new Error("area not created");
  const [l] = await tx
    .insert(location)
    .values({
      tenantId,
      type: "marina",
      name: `${name} marina`,
      position: { lng: 18.69, lat: 59.29 },
      areaId: a.id,
    })
    .returning();
  if (!l) throw new Error("location not created");
  const [l2] = await tx
    .insert(location)
    .values({
      tenantId,
      type: "yard",
      name: `${name} varv`,
      position: { lng: 18.72, lat: 59.3 },
      accessMethod: "ferry",
      crossingMinutes: 20,
    })
    .returning();
  if (!l2) throw new Error("second location not created");
  await tx.insert(travelCache).values({
    tenantId,
    fromLocationId: l.id,
    toLocationId: l2.id,
    departureHour: new Date("2027-04-20T06:00:00Z"),
    driveSeconds: 600,
    distanceMeters: 4000,
    provider: "fake",
  });
  await tx.insert(locationAccessRule).values({ tenantId, locationId: l.id, parking: "Grusplanen" });
  await tx.insert(boatPlacement).values({
    tenantId,
    boatId: b.id,
    locationId: l.id,
    season: "summer",
    mode: "water",
    launchDate: "2026-05-01",
    haulOutDate: "2026-10-15",
  });
  await tx
    .insert(accessInfo)
    .values({ tenantId, boatId: b.id, codeEncrypted: Buffer.from("not-a-real-ciphertext") });

  const [st] = await tx
    .insert(serviceType)
    .values({ tenantId, name: "Vårservice", defaultDurationMinutes: 120 })
    .returning();
  const [sup] = await tx.insert(supplier).values({ tenantId, name: "Marinbutiken" }).returning();
  const [p] = await tx
    .insert(part)
    .values({ tenantId, articleNumber: "21951346", description: "Impeller" })
    .returning();
  if (!st || !sup || !p) throw new Error("service type, supplier or part not created");
  const [j] = await tx
    .insert(job)
    .values({ tenantId, customerId: c.id, boatId: b.id, serviceTypeId: st.id, channel: "phone" })
    .returning();
  if (!j) throw new Error("job not created");
  const [v] = await tx
    .insert(visit)
    .values({
      tenantId,
      jobId: j.id,
      mechanicId: mechanic.id,
      timeWindow: timeRange(new Date("2027-04-20T06:00:00Z"), new Date("2027-04-20T08:00:00Z")),
      plannedMinutes: 120,
      status: "booked",
    })
    .returning();
  if (!v) throw new Error("visit not created");
  await tx
    .insert(jobLine)
    .values({ tenantId, jobId: j.id, type: "labour", description: "Arbete", unitPriceOre: 95_000 });
  await tx.insert(jobPart).values({ tenantId, jobId: j.id, partId: p.id, supplierId: sup.id });
  await tx
    .insert(workSchedule)
    .values({ tenantId, userId: mechanic.id, weekday: 1, startTime: "07:00", endTime: "17:00" });
  await tx.insert(scheduleBlock).values({
    tenantId,
    userId: mechanic.id,
    during: timeRange(new Date("2027-07-05T00:00:00Z"), new Date("2027-07-26T00:00:00Z")),
    reason: "Semester",
  });

  const [cl] = await tx
    .insert(call)
    .values({ tenantId, callerNumber: phone, customerId: c.id, startedAt: new Date(), jobId: j.id })
    .returning();
  const [m] = await tx
    .insert(message)
    .values({
      tenantId,
      channel: "sms",
      direction: "outbound",
      template: "f2_booking_confirmation",
      customerId: c.id,
      boatId: b.id,
      visitId: v.id,
      toAddress: phone,
      body: "Bokningen är klar.",
      status: "sent",
    })
    .returning();
  if (!cl || !m) throw new Error("call or message not created");
  await tx.insert(task).values({
    tenantId,
    type: "call_back",
    title: "Ring kunden",
    assigneeId: mechanic.id,
    customerId: c.id,
    callId: cl.id,
    messageId: m.id,
  });
  await tx.insert(waitlistEntry).values({ tenantId, customerId: c.id, boatId: b.id, areaId: a.id });
  const [cp] = await tx.insert(campaign).values({ tenantId, name: "Vårkampanj" }).returning();
  if (!cp) throw new Error("campaign not created");
  await tx
    .insert(campaignRecipient)
    .values({ tenantId, campaignId: cp.id, customerId: c.id, boatId: b.id });
  await tx.insert(survey).values({ tenantId, visitId: v.id, score: 5 });
  await tx.insert(consent).values({
    tenantId,
    customerId: c.id,
    type: "marketing_sms",
    status: "granted",
    source: "call",
  });
  await tx.insert(auditLog).values({
    tenantId,
    userId: mechanic.id,
    action: "access_code_viewed",
    subjectType: "visit",
    subjectId: v.id,
  });
  await tx.insert(kpiSnapshot).values({
    tenantId,
    snapshotDate: "2027-03-01",
    kpi: "kpi14_prebooking_spring",
    value: "0.62",
  });

  return {
    visitId: v.id,
    tenantId,
    mechanicId: mechanic.id,
    customerId: c.id,
    boatId: b.id,
    engineId: e.id,
    locationId: l.id,
    jobId: j.id,
  };
}
