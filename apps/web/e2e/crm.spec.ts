import { addDays, isoWeekday, stockholmInstant } from "@bojen/core";
import {
  BookingError,
  appUser,
  boat,
  boatOwnership,
  boatPlacement,
  connect,
  createBooking,
  customer,
  drive,
  engine,
  location,
  message,
  serviceType,
} from "@bojen/db";
import { DEMO_MARINAS, DEMO_TENANT_ID, OTHER_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { emailCode } from "./staff-login";

const ELIN = "elin@jonas-batservice.test"; // a mechanic: mechanics may read every customer
const PHONE = "+46701740690";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());

/** A customer with everything the card shows, and one in the other firm with the same words. */
async function seedCustomer() {
  const { db, close } = connect();
  try {
    const tenantId = DEMO_TENANT_ID;
    const [jonas] = await db
      .select()
      .from(appUser)
      .where(and(eq(appUser.tenantId, tenantId), eq(appUser.name, "Jonas Ek")));
    const [marina] = await db
      .select()
      .from(location)
      .where(and(eq(location.tenantId, tenantId), eq(location.slug, DEMO_MARINAS.bullando.slug)));
    const [service] = await db
      .select()
      .from(serviceType)
      .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Vinterkonservering")));
    if (!jonas || !marina || !service) throw new Error("The demo data is missing");

    const [kund] = await db
      .insert(customer)
      .values({
        tenantId,
        name: "Sökkund Sjöberg",
        phone: PHONE,
        email: "sok@exempel.test",
        acquisitionChannel: "recommendation",
      })
      .returning();
    const [b] = await db
      .insert(boat)
      .values({
        tenantId,
        name: "Sökbåten",
        make: "Nimbus",
        model: "3000",
        lengthM: "9.50",
        year: 2014,
      })
      .returning();
    if (!kund || !b) throw new Error("The customer was not created");
    await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: kund.id });
    const [e] = await db
      .insert(engine)
      .values({
        tenantId,
        boatId: b.id,
        make: "Volvo Penta",
        model: "D3-220",
        serialNumber: "E2E-MOTOR-4711",
      })
      .returning();
    if (!e) throw new Error("The engine was not created");
    await db
      .insert(drive)
      .values({ tenantId, engineId: e.id, type: "DPH", serialNumber: "E2E-DREV-0815" });
    await db.insert(boatPlacement).values({
      tenantId,
      boatId: b.id,
      locationId: marina.id,
      season: "winter",
      mode: "land",
      spotId: "B14",
      haulOutDate: addDays(today(), -30),
      launchDate: addDays(today(), 200),
    });

    for (let offset = 20; offset < 50; offset++) {
      const day = addDays(today(), offset);
      if (isoWeekday(day) > 5) continue;
      try {
        await createBooking(
          { db, now: () => new Date() },
          { tenantId, actor: { type: "staff", id: jonas.id }, idempotencyKey: `e2e-crm-${day}` },
          {
            customerId: kund.id,
            boatId: b.id,
            serviceTypeId: service.id,
            mechanicId: jonas.id,
            start: stockholmInstant(day, "13:00"),
            channel: "phone",
            needsApproval: false,
            partsMissing: false,
          },
        );
        break;
      } catch (error) {
        if (!(error instanceof BookingError && error.code === "conflict")) throw error;
      }
    }

    await db.insert(message).values([
      {
        tenantId,
        channel: "sms",
        direction: "outbound",
        template: "f3_check_land",
        customerId: kund.id,
        toAddress: PHONE,
        body: "Hej Sök! I morgon kl 12-16 kommer vi till Sökbåten.",
        status: "delivered",
        sentAt: new Date(Date.now() - 3_600_000),
      },
      {
        tenantId,
        channel: "sms",
        direction: "inbound",
        customerId: kund.id,
        fromAddress: PHONE,
        body: "Ja, den ligger kvar",
        status: "received",
        intent: "yes",
        createdAt: new Date(Date.now() - 1_800_000),
      },
    ]);

    // The other firm has a customer with the same name and number, who must never show up.
    const [stranger] = await db
      .insert(customer)
      .values({ tenantId: OTHER_TENANT_ID, name: "Sökkund Främling", phone: "+46701740691" })
      .returning();
    const [strangerBoat] = await db
      .insert(boat)
      .values({ tenantId: OTHER_TENANT_ID, name: "Främlingsbåten", make: "Nimbus", model: "3000" })
      .returning();
    if (!stranger || !strangerBoat) throw new Error("The other firm's customer was not created");
    await db
      .insert(boatOwnership)
      .values({ tenantId: OTHER_TENANT_ID, boatId: strangerBoat.id, customerId: stranger.id });
  } finally {
    await close();
  }
}

test("staff find a customer by phone, name, boat, serial number and marina, and open the card (step 5.1)", async ({
  page,
}) => {
  await seedCustomer();
  await emailCode(page, ELIN, "/kunder");
  await expect(page).toHaveURL(/\/kunder$/);
  await expect(page.getByRole("heading", { name: "Kunder", level: 1 })).toBeVisible();

  const search = page.getByRole("search");
  const found = page.getByRole("link", { name: /Sökkund Sjöberg/ });
  const lookFor = async (query: string) => {
    await search.getByLabel("Sök kund").fill(query);
    await search.getByRole("button", { name: "Sök" }).click();
    await expect(page).toHaveURL(/\/kunder\?q=/);
  };

  // Phone, however it is written; name; boat model; serial numbers; marina.
  for (const query of [
    "070-174 06 90",
    "+46 70 174 06 90",
    "0701740690",
    "sökkund",
    "Nimbus 3000 Sjöberg",
    "Sökbåten",
    "E2E-MOTOR-4711",
    "e2e-drev-0815",
    "D3-220 Sökkund",
    "Bullandö Sjöberg",
  ]) {
    await lookFor(query);
    await expect(found, query).toBeVisible();
    // The other firm's customer with the same words is never in the list.
    await expect(page.getByText("Främling")).toHaveCount(0);
  }

  // What is in the list: the number as Swedes write it, and the boat with its marina.
  await lookFor("Sökkund");
  await expect(found).toContainText("070-174 06 90");
  await expect(found).toContainText("Sökbåten (Nimbus 3000) – Bullandö Marina");
  await expect(page.getByRole("link", { name: /Främling/ })).toHaveCount(0);

  // Nothing found says so.
  await lookFor("Zzzzzzzz");
  await expect(page.getByRole("status")).toHaveText("Inga kunder hittades.");

  // The customer card.
  await lookFor("Sökkund");
  await found.click();
  await expect(page.getByRole("heading", { name: "Sökkund Sjöberg", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "070-174 06 90" })).toHaveAttribute(
    "href",
    `tel:${PHONE}`,
  );
  await expect(page.getByText("sok@exempel.test")).toBeVisible();
  await expect(page.getByText("recommendation")).toBeVisible();

  const boats = page.getByRole("region", { name: "Båtar" });
  await expect(boats).toContainText("Sökbåten (Nimbus 3000)");
  await expect(boats).toContainText("Ägare");
  await expect(boats).toContainText("9,5 m");
  await expect(boats).toContainText("årsmodell 2014");
  await expect(boats).toContainText("Bullandö Marina B14, på land");

  const visits = page.getByRole("region", { name: "Besök" });
  await expect(visits.getByRole("heading", { name: "Kommande" })).toBeVisible();
  await expect(visits).toContainText("Bokad");
  await expect(visits).toContainText("Vinterkonservering");
  await expect(visits).toContainText("Jonas Ek");

  // The timeline: the sms the firm sent and the reply, newest first, with what they were.
  const timeline = page.getByRole("region", { name: "Meddelanden" }).getByRole("listitem");
  await expect(timeline).toHaveCount(2);
  await expect(timeline.first()).toContainText("Ja, den ligger kvar");
  await expect(timeline.first()).toContainText("Från kunden");
  await expect(timeline.first()).toContainText("tolkat som ja");
  await expect(timeline.last()).toContainText("Tillgänglighetskontroll");
  await expect(timeline.last()).toContainText("Levererad");
  await expect(timeline.last()).toContainText(
    "Hej Sök! I morgon kl 12-16 kommer vi till Sökbåten.",
  );

  // Back to the list, and the menu leads on.
  await page.getByRole("link", { name: "Alla kunder" }).click();
  await expect(page).toHaveURL(/\/kunder$/);
  await expect(page.getByRole("navigation", { name: "Meny" })).toContainText("Förfrågningar");

  // A customer of the other firm, or one that does not exist, is not found.
  const { db, close } = connect();
  try {
    const [stranger] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(and(eq(customer.tenantId, OTHER_TENANT_ID), eq(customer.name, "Sökkund Främling")));
    if (!stranger) throw new Error("The other firm's customer is missing");
    const response = await page.goto(`/kunder/${stranger.id}`);
    expect(response?.status()).toBe(404);
  } finally {
    await close();
  }
  expect((await page.goto("/kunder/inte-ett-id"))?.status()).toBe(404);

  // Sign out again: the staff test counts Elin's sessions, and this one must not be among them.
  await page.goto("/kunder");
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});

test("the customer pages ask for a sign-in (step 5.1)", async ({ page }) => {
  await page.goto("/kunder");
  await expect(page).toHaveURL(/\/logga-in\?nasta=/);
  await page.goto("/kunder/00000000-0000-4000-8000-000000000000");
  await expect(page).toHaveURL(/\/logga-in\?nasta=/);
});
