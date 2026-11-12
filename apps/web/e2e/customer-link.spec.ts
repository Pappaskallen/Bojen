import { addDays, isoWeekday, stockholmInstant } from "@bojen/core";
import {
  BookingError,
  accessInfo,
  appUser,
  boat,
  boatOwnership,
  boatPlacement,
  connect,
  createBooking,
  createShortLink,
  customer,
  location,
  serviceType,
  visit,
} from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { E2E_SHORT_LINK_KEY } from "./keys";

const PHONE = "+46701740688";
const tenantId = DEMO_TENANT_ID;
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());

/**
 * A customer with a boat at Bullandö and a booking two weeks ahead, the way the worker leaves
 * it after F1: a short link to manage it. Also an expired link to the same visit.
 */
async function bookedCustomer(db: ReturnType<typeof connect>["db"]) {
  const [jonas] = await db
    .select()
    .from(appUser)
    .where(and(eq(appUser.tenantId, tenantId), eq(appUser.name, "Jonas Ek")));
  const [bullando] = await db
    .select()
    .from(location)
    .where(and(eq(location.tenantId, tenantId), eq(location.slug, "bullando-marina")));
  const [layUp] = await db
    .select()
    .from(serviceType)
    .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Vinterkonservering")));
  if (!jonas || !bullando || !layUp) throw new Error("The demo data is missing");

  const [per] = await db
    .insert(customer)
    .values({ tenantId, name: "Länk Kund", phone: PHONE })
    .returning();
  const [b] = await db.insert(boat).values({ tenantId, name: "Länkbåten" }).returning();
  if (!per || !b) throw new Error("The customer was not created");
  await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: per.id });
  await db.insert(boatPlacement).values({
    tenantId,
    boatId: b.id,
    locationId: bullando.id,
    season: "winter",
    mode: "land",
    haulOutDate: addDays(today(), -30),
  });

  for (let offset = 14; offset < 44; offset++) {
    const day = addDays(today(), offset);
    if (isoWeekday(day) > 5) continue;
    try {
      const booked = await createBooking(
        { db, now: () => new Date() },
        { tenantId, actor: { type: "staff", id: jonas.id }, idempotencyKey: `e2e-link-${day}` },
        {
          customerId: per.id,
          boatId: b.id,
          serviceTypeId: layUp.id,
          mechanicId: jonas.id,
          start: stockholmInstant(day, "13:00"),
          channel: "phone",
          needsApproval: false,
          partsMissing: false,
        },
      );
      const visitId = booked.visit.id;
      const code = await createShortLink(db, E2E_SHORT_LINK_KEY, {
        tenantId,
        visitId,
        purpose: "manage",
        expiresAt: new Date(booked.visit.start),
      });
      const expired = await createShortLink(db, E2E_SHORT_LINK_KEY, {
        tenantId,
        visitId,
        purpose: "manage",
        expiresAt: new Date(Date.now() - 60_000),
      });
      return {
        visitId,
        code,
        expired,
        boatId: b.id,
        mechanicId: jonas.id,
        serviceTypeId: layUp.id,
        customerId: per.id,
        oldStart: new Date(booked.visit.start),
      };
    } catch (error) {
      if (!(error instanceof BookingError && error.code === "conflict")) throw error;
    }
  }
  throw new Error("Found no free time for the booking");
}

test("a customer reschedules through the link, and the old time is free again", async ({
  page,
}) => {
  const { db, close } = connect();
  try {
    const f = await bookedCustomer(db);

    await page.goto(`/x/${f.code}`);
    await expect(page.getByRole("heading", { name: "Din bokning" })).toBeVisible();
    await expect(page.getByText("Vinterkonservering")).toBeVisible();
    await expect(page.getByText(/Avbokning är kostnadsfri fram till/)).toBeVisible();

    // Pick the first new time the page offers.
    const choices = page.locator("label.choice");
    await expect(choices.first()).toBeVisible();
    const chosen = await choices.first().getByRole("radio").inputValue();
    const newStart = new Date(chosen.split("|")[1] ?? "");
    await choices.first().getByRole("radio").check();
    await page.getByRole("button", { name: "Boka om till vald tid" }).click();
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Klart, besöket är ombokat",
    );

    // The visit has the new time.
    const [row] = await db
      .select({ start: sql<string>`lower(${visit.timeWindow})` })
      .from(visit)
      .where(eq(visit.id, f.visitId));
    expect(new Date(row?.start ?? 0).getTime()).toBe(newStart.getTime());
    expect(newStart.getTime()).not.toBe(f.oldStart.getTime());

    // The old time is free: the mechanic can be booked there again.
    const again = await createBooking(
      { db, now: () => new Date() },
      { tenantId, actor: { type: "staff", id: f.mechanicId }, idempotencyKey: "e2e-link-again" },
      {
        customerId: f.customerId,
        boatId: f.boatId,
        serviceTypeId: f.serviceTypeId,
        mechanicId: f.mechanicId,
        start: f.oldStart,
        channel: "phone",
        needsApproval: false,
        partsMissing: false,
      },
    );
    expect(again.visit.start).toBe(f.oldStart.toISOString());
    // Leave the calendar as the other tests expect it.
    await db.update(visit).set({ status: "cancelled" }).where(eq(visit.id, again.visit.id));

    // The link is used up now.
    await page.goto(`/x/${f.code}`);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Länken är redan använd");
    await expect(page.getByRole("button", { name: "Boka om till vald tid" })).toHaveCount(0);

    // An expired link says so and offers nothing to change.
    await page.goto(`/x/${f.expired}`);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Länken har gått ut");
    await expect(page.getByRole("button")).toHaveCount(0);

    // A code that does not exist.
    await page.goto("/x/Zz9Zz9Zz");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Länken finns inte");
  } finally {
    await close();
  }
});

test("a customer leaves the boat's code through the link, and it is stored encrypted", async ({
  page,
}) => {
  const { db, close } = connect();
  try {
    // The visit the first test rescheduled, with a fresh link like the new F1 brings.
    const [link] = await db.execute<{ id: string; start: string; boat_id: string }>(sql`
      select v.id, lower(v.time_window) as start, j.boat_id
      from visit v join job j on j.id = v.job_id
      join customer c on c.id = j.customer_id
      where c.phone = ${PHONE} and v.status = 'booked' limit 1`);
    if (!link) throw new Error("The first test did not leave a booked visit");
    const code = await createShortLink(db, E2E_SHORT_LINK_KEY, {
      tenantId,
      visitId: link.id,
      purpose: "manage",
      expiresAt: new Date(link.start),
    });

    await page.goto(`/x/${code}`);
    await page.getByLabel("Kod (lås, larm eller grind)").fill("4711#");
    await page.getByLabel("Var finns nyckeln?").fill("Under fendern i aktern");
    await page.getByRole("button", { name: "Spara uppgifterna" }).click();
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "Uppgifterna är sparade",
    );
    // The page never shows what was stored.
    await expect(page.getByText("4711#")).toHaveCount(0);
    await expect(page.getByText("Du har redan lämnat uppgifter")).toBeVisible();

    const [stored] = await db.select().from(accessInfo).where(eq(accessInfo.boatId, link.boat_id));
    expect(stored?.codeEncrypted).toBeTruthy();
    expect(stored?.codeEncrypted?.toString("latin1")).not.toContain("4711");
    expect(stored?.keyLocationEncrypted?.toString("latin1")).not.toContain("fendern");
  } finally {
    await close();
  }
});
