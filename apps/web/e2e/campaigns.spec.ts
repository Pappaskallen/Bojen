import { appUser, campaign, campaignRecipient, connect } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { emailCode, signInOwner } from "./staff-login";

/** People of their own, independent of the other staff tests. */
const KARIN = "karin@jonas-batservice.test"; // owner
const MATS = "mats@jonas-batservice.test"; // mechanic
const tenantId = DEMO_TENANT_ID;

test.beforeAll(async () => {
  const { db, close } = connect();
  try {
    await db.insert(appUser).values([
      { tenantId, name: "Karin Ägare", role: "owner", email: KARIN },
      { tenantId, name: "Mats Mekaniker", role: "mechanic", email: MATS },
    ]);
  } finally {
    await close();
  }
});

test("the owner makes a spring campaign from last year's visits and starts it (step 5.6)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInOwner(page, KARIN, "/kampanjer");
  await expect(page.getByRole("heading", { name: "Kampanjer", level: 1 })).toBeVisible();

  // The form proposes next spring, 10 January, and the services by their names.
  const form = page.getByRole("region", { name: "Ny vårkampanj" });
  await expect(form.getByLabel("Namn")).toHaveValue(/^Vårkampanj \d{4}$/);
  await expect(
    form
      .getByRole("group", { name: /vårservice förra våren/ })
      .getByLabel("Vårservice och sjösättningskontroll"),
  ).toBeChecked();
  await expect(
    form
      .getByRole("group", { name: /vinterkonservering i höstas/ })
      .getByLabel("Vinterkonservering"),
  ).toBeChecked();
  await form.getByLabel("Namn").fill("Vårkampanj E2E");
  await form.getByRole("button", { name: "Skapa utkast" }).click();

  // The draft shows who it would go to: every demo boat had its spring service last April.
  await expect(page.getByRole("heading", { name: "Vårkampanj E2E", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Utkastet är skapat. Se mottagarna och starta när du är redo.",
  );
  const recipients = page.getByRole("region", { name: "Mottagare" });
  await expect(recipients).toContainText(/Segment A: vårservice förra våren: [1-9]\d*/);
  await expect(recipients).toContainText("Segment C");

  await page.getByRole("button", { name: "Starta kampanjen" }).click();
  await expect(page.getByRole("status")).toHaveText("Kampanjen är startad.");
  await expect(page.getByText("Planerad")).toBeVisible();
  await expect(page.getByText(/Första utskicket: /)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Mottagare" }).getByText("Väntar på utskick").first(),
  ).toBeVisible();

  // In the database: scheduled, with a recipient per boat in segment A, and its first round.
  const { db, close } = connect();
  try {
    const [c] = await db.select().from(campaign).where(eq(campaign.name, "Vårkampanj E2E"));
    expect(c?.status).toBe("scheduled");
    const rows = await db
      .select({ segment: campaignRecipient.segment })
      .from(campaignRecipient)
      .where(eq(campaignRecipient.campaignId, c?.id ?? ""));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.segment === "A")).toBe(true);
  } finally {
    await close();
  }

  // Started once: a second start says so.
  await page.goto("/kampanjer");
  await expect(page.getByRole("link", { name: "Vårkampanj E2E" })).toBeVisible();
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});

test("a mechanic sees the campaigns but cannot make or start one (step 5.6)", async ({ page }) => {
  await emailCode(page, MATS, "/kampanjer");
  await expect(page).toHaveURL(/\/kampanjer$/);
  await expect(page.getByRole("region", { name: "Ny vårkampanj" })).toHaveCount(0);
  const refused = await page.request.post("/api/kampanjer", {
    form: { name: "Smygkampanj", year: "2027", startDate: "2027-01-10" },
    headers: { Origin: new URL(page.url()).origin },
    maxRedirects: 0,
  });
  expect(refused.status()).toBe(303);
  expect(refused.headers().location).toBe("/kampanjer?fel=forbidden");
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});
