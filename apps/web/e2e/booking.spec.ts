import { stockholmDate } from "@bojen/core";
import { attachment, connect, customer, job, visit } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { NEIGHBOUR_PHONE } from "./global-setup";

// A 1×1 PNG, enough to test the upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const NEW_PHONE = "+46701740686";

test("a new customer books winter lay-up at Bullandö on a marina day", async ({ page }) => {
  const { db, close } = connect();
  try {
    const [neighbourVisit] = await db
      .select({ start: sql<string>`lower(${visit.timeWindow})` })
      .from(visit)
      .innerJoin(job, eq(job.id, visit.jobId))
      .innerJoin(customer, eq(customer.id, job.customerId))
      .where(and(eq(customer.tenantId, DEMO_TENANT_ID), eq(customer.phone, NEIGHBOUR_PHONE)));
    if (!neighbourVisit) throw new Error("The global setup did not book the neighbour");
    const marinaDay = stockholmDate(new Date(neighbourVisit.start));

    await page.goto("/boka/jonas-batservice/m/bullando-marina");
    await expect(page.getByRole("heading", { name: "Boka hos Jonas Båtservice" })).toBeVisible();

    // 1. Service
    await page.getByRole("radio", { name: /Vinterkonservering/ }).check();
    await page.getByRole("button", { name: "Nästa" }).click();

    // 2. Customer and boat
    await page.getByLabel("Ditt namn").fill("Per Testsson");
    await page.getByLabel("Mobilnummer").fill("070-174 06 86");
    await page.getByLabel("Båtmärke").fill("Nimbus");
    await page.getByLabel("Modell", { exact: true }).fill("305 Coupé");
    await page.getByRole("button", { name: "Nästa" }).click();

    // 3. Place: Bullandö is chosen by the marina link; the boat is on land.
    await expect(page.getByLabel("Välj plats")).not.toHaveValue("");
    await page.getByRole("radio", { name: "På land" }).check();
    await page.getByRole("button", { name: "Nästa" }).click();

    // 4. Time: the marina day comes first and says so.
    const choices = page.locator("label.choice");
    await expect(choices.first()).toContainText("Mekanikern är på Bullandö Marina denna dag");
    await expect(choices.first()).toContainText("framkörning 0 kr (spara 695 kr)");
    await choices.first().getByRole("radio").check();
    await page.getByRole("button", { name: "Nästa" }).click();

    // 5. Pictures
    await page
      .getByLabel("Lägg till bilder")
      .setInputFiles({ name: "drev.png", mimeType: "image/png", buffer: PNG });
    await page
      .getByLabel("Något mer vi bör veta? (valfritt)")
      .fill("Nyckeln finns i nyckelskåpet.");
    await page.getByRole("button", { name: "Nästa" }).click();

    // 6. Confirm
    await expect(page.getByText("Stämmer det här?")).toBeVisible();
    await page.getByRole("button", { name: "Skicka bokningen" }).click();
    await expect(page.getByText(/Vi har tagit emot din bokning/)).toBeVisible();

    // The booking is in the database, on the marina day, waiting for approval.
    const rows = await db
      .select({
        status: visit.status,
        start: sql<string>`lower(${visit.timeWindow})`,
        jobId: job.id,
        description: job.description,
      })
      .from(visit)
      .innerJoin(job, eq(job.id, visit.jobId))
      .innerJoin(customer, eq(customer.id, job.customerId))
      .where(and(eq(customer.tenantId, DEMO_TENANT_ID), eq(customer.phone, NEW_PHONE)));
    expect(rows).toHaveLength(1);
    const [booked] = rows;
    expect(booked).toMatchObject({
      status: "pending_approval",
      description: "Nyckeln finns i nyckelskåpet.",
    });
    expect(stockholmDate(new Date(booked?.start ?? ""))).toBe(marinaDay);
    const files = await db
      .select()
      .from(attachment)
      .where(eq(attachment.ownerId, booked?.jobId ?? ""));
    expect(files.map((f) => f.contentType)).toEqual(["image/png"]);
  } finally {
    await close();
  }
});

test("a wrong sms code is refused", async ({ page }) => {
  await page.goto("/boka/jonas-batservice");
  await page.getByRole("radio", { name: /Vårservice/ }).check();
  await page.getByRole("button", { name: "Nästa" }).click();
  await page.getByRole("radio", { name: "Jag har bokat förut" }).check();
  await page.getByLabel("Mobilnummer").fill("070-174 06 97");
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Vi har skickat en kod/)).toBeVisible();
  // The code goes to the fake sms on the server; a made-up one must not work.
  await page.getByLabel("Kod från sms").fill("000000");
  await page.getByRole("button", { name: "Logga in" }).click();
  await expect(page.getByText("Koden stämmer inte. Försök igen.")).toBeVisible();
});

test("an unknown firm gives 404", async ({ page }) => {
  const response = await page.goto("/boka/finns-inte");
  expect(response?.status()).toBe(404);
});
