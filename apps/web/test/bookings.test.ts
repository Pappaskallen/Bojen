/**
 * The booking routes against the local database. Concurrent requests need real commits,
 * so the test makes its own firm and removes it afterwards instead of rolling back.
 */
import { stockholmInstant } from "@bojen/core";
import {
  appUser,
  connect,
  customer,
  domainEvent,
  idempotencyKey,
  job,
  serviceType,
  tenant,
  visit,
  workSchedule,
} from "@bojen/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingRoutes, type RequestContext } from "../lib/bookings";

const connection = connect();
const db = connection.db;
let ids: { tenantId: string; mechanicId: string; customerId: string; serviceTypeId: string };
let caller: RequestContext | null;

const routes = createBookingRoutes({
  db: () => db,
  now: () => new Date("2027-04-01T08:00:00Z"),
  authorize: () => Promise.resolve(caller),
});

beforeAll(async () => {
  const [t] = await db.insert(tenant).values({ name: "Samtidighetstest" }).returning();
  const tenantId = t!.id;
  const [m] = await db
    .insert(appUser)
    .values({ tenantId, name: "Jonas", role: "mechanic" })
    .returning();
  await db.insert(workSchedule).values({
    tenantId,
    userId: m!.id,
    weekday: 2,
    startTime: "07:00",
    endTime: "17:00",
  });
  const [c] = await db.insert(customer).values({ tenantId, name: "Anna" }).returning();
  const [s] = await db
    .insert(serviceType)
    .values({ tenantId, name: "Vårservice", defaultDurationMinutes: 120 })
    .returning();
  ids = { tenantId, mechanicId: m!.id, customerId: c!.id, serviceTypeId: s!.id };
});

afterAll(async () => {
  const { tenantId } = ids;
  for (const table of [
    domainEvent,
    idempotencyKey,
    visit,
    job,
    workSchedule,
    serviceType,
    customer,
    appUser,
  ]) {
    await db.delete(table).where(eq(table.tenantId, tenantId));
  }
  await db.delete(tenant).where(eq(tenant.id, tenantId));
  await connection.close();
});

const staff = () => ({
  tenantId: ids.tenantId,
  actor: { type: "staff" as const, id: ids.mechanicId },
});

function post(url: string, key: string | null, payload?: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

const booking = (hhmm: string, day = "2027-04-20") => ({
  customerId: ids.customerId,
  serviceTypeId: ids.serviceTypeId,
  mechanicId: ids.mechanicId,
  start: stockholmInstant(day, hhmm).toISOString(),
  channel: "phone",
});

describe("POST /api/bookings", () => {
  it("gives one booking and one 409 when two people book the same time at once", async () => {
    caller = staff();
    const responses = await Promise.all([
      routes.create(post("/api/bookings", "parallel-a", booking("08:00"))),
      routes.create(post("/api/bookings", "parallel-b", booking("08:00"))),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const refused = responses.find((r) => r.status === 409);
    expect(await refused?.json()).toEqual({ error: "conflict", detail: "overlaps_visit" });
    const visits = await db.select().from(visit).where(eq(visit.tenantId, ids.tenantId));
    expect(visits).toHaveLength(1);
  });

  it("keeps the buffer between two bookings made at once (the row lock, not the constraint)", async () => {
    caller = staff();
    // 08–10 and 10:05–12:05 do not overlap, but 10:05 is inside the 15 min buffer.
    const responses = await Promise.all([
      routes.create(post("/api/bookings", "buffer-a", booking("08:00", "2027-05-04"))),
      routes.create(post("/api/bookings", "buffer-b", booking("10:05", "2027-05-04"))),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("books once when the same request is sent twice at once", async () => {
    caller = staff();
    const [a, b] = await Promise.all([
      routes.create(post("/api/bookings", "twice", booking("13:00"))),
      routes.create(post("/api/bookings", "twice", booking("13:00"))),
    ]);
    expect([a!.status, b!.status]).toEqual([201, 201]);
    const [first, second] = [await a!.json(), await b!.json()];
    expect(first).toEqual(second);
    expect([a, b].filter((r) => r!.headers.get("Idempotent-Replayed") === "true")).toHaveLength(1);
  });

  it("refuses requests without sign-in, key or valid input", async () => {
    caller = null;
    expect((await routes.create(post("/api/bookings", "k1", booking("15:00")))).status).toBe(401);
    caller = staff();
    expect((await routes.create(post("/api/bookings", null, booking("15:00")))).status).toBe(400);
    const bad = await routes.create(
      post("/api/bookings", "k2", { ...booking("15:00"), start: "soon" }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_input", detail: "start" });
  });

  it("sends a new customer's booking for approval and books it when the mechanic approves (step 2.6)", async () => {
    caller = { tenantId: ids.tenantId, actor: { type: "customer", id: ids.customerId } };
    const response = await routes.create(post("/api/bookings", "customer-1", booking("10:30")));
    expect(response.status).toBe(201);
    const { visit: v } = (await response.json()) as { visit: { id: string; status: string } };
    expect(v.status).toBe("pending_approval");

    // The customer cannot approve their own booking …
    const own = await routes.change(
      post(`/api/bookings/${v.id}/approve`, "approve-own"),
      v.id,
      "approve",
    );
    expect(own.status).toBe(403);
    // … the mechanic can.
    caller = staff();
    const approved = await routes.change(
      post(`/api/bookings/${v.id}/approve`, "approve-1"),
      v.id,
      "approve",
    );
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as { visit: { status: string } }).visit.status).toBe("booked");
  });
});

describe("POST /api/bookings/{id}/{action}", () => {
  it("cancels once and answers 409 to a second cancel", async () => {
    caller = staff();
    const created = await routes.create(
      post("/api/bookings", "to-cancel", booking("08:00", "2027-04-27")),
    );
    const { visit: v } = (await created.json()) as { visit: { id: string } };

    const cancel = await routes.change(
      post(`/api/bookings/${v.id}/cancel`, "cancel-1"),
      v.id,
      "cancel",
    );
    expect(cancel.status).toBe(200);
    const again = await routes.change(
      post(`/api/bookings/${v.id}/cancel`, "cancel-2"),
      v.id,
      "cancel",
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: "invalid_transition",
      detail: "cancelled → cancel",
    });

    expect((await routes.change(post("/x", "k3"), v.id, "teleport")).status).toBe(404);
    expect((await routes.change(post("/x", "k4"), "not-a-uuid", "cancel")).status).toBe(400);
  });
});
