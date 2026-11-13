import { stockholmDate } from "@bojen/core";
import {
  appUser,
  attachment,
  boat,
  boatOwnership,
  connect,
  customer,
  job,
  serviceType,
  visit,
} from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { emailCode } from "./staff-login";

const UNO = "uno@jonas-batservice.test"; // a mechanic of their own, with one visit today
const tenantId = DEMO_TENANT_ID;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function seed() {
  const { db, close } = connect();
  try {
    const [uno] = await db
      .insert(appUser)
      .values({ tenantId, name: "Uno Mekaniker", role: "mechanic", email: UNO })
      .returning();
    const [service] = await db
      .select()
      .from(serviceType)
      .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Felsökning")));
    const [kund] = await db
      .insert(customer)
      .values({ tenantId, name: "Offline Kund", phone: "+46701740695" })
      .returning();
    const [b] = await db.insert(boat).values({ tenantId, name: "Skärbåten" }).returning();
    if (!uno || !service || !kund || !b) throw new Error("The test data was not created");
    await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: kund.id });
    const [j] = await db
      .insert(job)
      .values({
        tenantId,
        customerId: kund.id,
        boatId: b.id,
        serviceTypeId: service.id,
        channel: "phone",
      })
      .returning();
    if (!j) throw new Error("The job was not created");
    let start = new Date(Date.now() + 3_600_000);
    if (stockholmDate(start) !== stockholmDate(new Date()))
      start = new Date(Date.now() - 3_600_000);
    const [v] = await db
      .insert(visit)
      .values({
        tenantId,
        jobId: j.id,
        mechanicId: uno.id,
        timeWindow: `[${start.toISOString()},${new Date(start.getTime() + 3_600_000).toISOString()})`,
        plannedMinutes: 60,
        // Started already, on the island with coverage.
        status: "in_progress",
      })
      .returning();
    if (!v) throw new Error("The visit was not created");
    return { visitId: v.id };
  } finally {
    await close();
  }
}

test("without coverage the mechanic finishes a visit with a picture and a note, and it all goes when the network is back (step 5.5b)", async ({
  page,
  context,
}) => {
  const { visitId } = await seed();
  await emailCode(page, UNO, "/idag");
  await expect(page).toHaveURL(/\/idag$/);

  // The service worker takes over, and the day view is kept on the phone.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole("listitem", { name: "Offline Kund" })).toBeVisible();

  // Out on the skerries: no coverage. The page still opens.
  await context.setOffline(true);
  await page.reload();
  const card = page.getByRole("listitem", { name: "Offline Kund" });
  await expect(card).toContainText("Skärbåten");

  // A picture, a note and done, all without coverage.
  await card.getByText(/^Bilder/).click();
  await card.getByLabel("Ta eller välj bild").setInputFiles({
    name: "drev.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await card.getByRole("button", { name: "Ladda upp" }).click();
  await expect(page.getByText("1 ändring väntar på täckning.")).toBeVisible();

  await card.getByText("Anteckning", { exact: true }).click();
  await card
    .getByLabel("Det du skriver här blir underlag för rapporten.")
    .fill("Bytt drevolja. Bälgen ser sliten ut.");
  await card.getByRole("button", { name: "Spara anteckning" }).click();
  await expect(page.getByText("2 ändringar väntar på täckning.")).toBeVisible();

  await card.getByRole("button", { name: "Klart" }).click();
  await expect(page.getByText("3 ändringar väntar på täckning.")).toBeVisible();

  // Nothing has reached the server yet.
  const { db, close } = connect();
  try {
    const status = async () =>
      (
        await db
          .select({ s: visit.status, n: visit.notes })
          .from(visit)
          .where(eq(visit.id, visitId))
      )[0];
    expect(await status()).toEqual({ s: "in_progress", n: null });

    // Coverage again: everything is sent in order and the page shows the day as it is.
    await context.setOffline(false);
    await expect(page.getByRole("main").getByRole("status").first()).toHaveText(
      "Allt som väntade är skickat.",
      { timeout: 20_000 },
    );
    await expect(page.getByText(/väntar på täckning/)).toHaveCount(0);
    await expect(page.getByRole("listitem", { name: "Offline Kund" })).toContainText("Utfört");

    expect(await status()).toEqual({ s: "done", n: "Bytt drevolja. Bälgen ser sliten ut." });
    const pictures = await db
      .select()
      .from(attachment)
      .where(and(eq(attachment.ownerType, "visit"), eq(attachment.ownerId, visitId)));
    expect(pictures).toHaveLength(1);
  } finally {
    await close();
  }
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});
