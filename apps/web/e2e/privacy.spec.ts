import { readFileSync } from "node:fs";
import { customer, connect, appUser, auditLog } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { signInOwner } from "./staff-login";

/** Export and erasure from the customer card (byggplan step 7.4), for a customer of its own. */
const tenantId = DEMO_TENANT_ID;
const OWNER = "radera@jonas-batservice.test";
const NAME = "Radera Kundsson";
// Outside the demo data's numbers (fictionalMobile: 0605–0644 and 0695–0699).
const PHONE = "+46701740681";
let customerId = "";

test.beforeAll(async () => {
  const { db, close } = connect();
  try {
    await db
      .insert(appUser)
      .values({ tenantId, name: "Radera Ägare", role: "owner", email: OWNER });
    const [c] = await db
      .insert(customer)
      .values({ tenantId, name: NAME, phone: PHONE, email: "radera@example.se" })
      .returning({ id: customer.id });
    customerId = c?.id ?? "";
  } finally {
    await close();
  }
});

test("the owner exports a customer's data and then erases the customer", async ({ page }) => {
  test.setTimeout(120_000);
  await signInOwner(page, OWNER, `/kunder/${customerId}`);
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportera kundens uppgifter (JSON)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`kund-${customerId}.json`);
  const exported = (await (await page.request.get(`/api/kunder/${customerId}/export`)).json()) as {
    customer: { name: string; phone: string };
  };
  expect(exported.customer).toMatchObject({ name: NAME, phone: PHONE });

  // The same as a pdf to read.
  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportera kundens uppgifter (pdf)" }).click();
  const pdfFile = await pdfDownload;
  expect(pdfFile.suggestedFilename()).toBe(`kund-${customerId}.pdf`);
  const pdfPath = await pdfFile.path();
  expect(readFileSync(pdfPath).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Without the word nothing happens.
  await page.getByLabel("Skriv RADERA för att bekräfta").fill("ja");
  await page.getByRole("button", { name: "Radera kunden" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Skriv RADERA i rutan för att radera kunden.",
  );

  await page.getByLabel("Skriv RADERA för att bekräfta").fill("RADERA");
  await page.getByRole("button", { name: "Radera kunden" }).click();
  await expect(page).toHaveURL(/\/kunder\?raderad=1$/);
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Kunden är raderad.");
  expect((await page.request.get(`/kunder/${customerId}`)).status()).toBe(404);

  const { db, close } = connect();
  try {
    const [row] = await db.select().from(customer).where(eq(customer.id, customerId));
    expect(row).toMatchObject({ name: "Raderad kund", phone: null, email: null });
    const logged = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.subjectId, customerId)));
    expect(logged.map((l) => l.action).sort()).toEqual([
      "customer.erased",
      "customer.exported",
      "customer.exported",
      "customer.exported",
    ]);
  } finally {
    await close();
  }
});

test("the owner chooses 30 days of call audio, and back to 90", async ({ page }) => {
  test.setTimeout(90_000);
  await signInOwner(page, OWNER, "/sakerhet");
  const section = page.getByRole("region", { name: "Inspelade samtal" });
  await expect(section.getByText("Ljudet sparas i 90 dagar.")).toBeVisible();

  await section.getByLabel("30 dagar").check();
  await section.getByRole("button", { name: "Spara" }).click();
  await expect(section.getByRole("status")).toHaveText(
    "Sparat. Ljud äldre än 30 dagar tas bort i natt.",
  );
  await expect(section.getByLabel("30 dagar")).toBeChecked();

  await section.getByLabel("90 dagar (standard)").check();
  await section.getByRole("button", { name: "Spara" }).click();
  await expect(section.getByText("Ljudet sparas i 90 dagar.")).toBeVisible();
});
