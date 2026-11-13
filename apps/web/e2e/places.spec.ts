import { expect, test } from "@playwright/test";
import { emailCode } from "./staff-login";

const ELIN = "elin@jonas-batservice.test"; // a mechanic: mechanics may read every card

test("the marina card shows contacts, access rules, boats, dates and the booking link (step 5.3)", async ({
  page,
}) => {
  await emailCode(page, ELIN, "/marinor");
  await expect(page).toHaveURL(/\/marinor$/);
  await expect(page.getByRole("heading", { name: "Marinor och varv", level: 1 })).toBeVisible();
  // Marinas, clubs and yards from the demo data, each with how many boats are there now.
  const list = page.getByRole("list").filter({ hasText: "Bullandö Marina" });
  await expect(list).toContainText("Djurö Båtvarv");
  await expect(list).toContainText(/båt(ar)? här nu/);

  await page.getByRole("link", { name: /Bullandö Marina/ }).click();
  await expect(page.getByRole("heading", { name: "Bullandö Marina", level: 1 })).toBeVisible();

  const contacts = page.getByRole("region", { name: "Kontaktpersoner" });
  await expect(contacts).toContainText("Lena Strand");
  await expect(contacts).toContainText("Hamnkapten");
  await expect(contacts.getByRole("link", { name: "070-555 01 01" })).toHaveAttribute(
    "href",
    "tel:+46705550101",
  );

  const rules = page.getByRole("region", { name: "Regler för tillträde" });
  await expect(rules).toContainText("Vardagar 07-19");
  await expect(rules).toContainText("Anmäl dig i marinakontoret.");
  await expect(rules).toContainText("Stora parkeringen vid infarten.");

  // The boats there, each a link to its boat card, and the dates they go in and come up.
  const boats = page.getByRole("region", { name: "Båtar" });
  await expect(boats.getByRole("link").first()).toBeVisible();
  const dates = page.getByRole("region", { name: "Sjösättning och upptagning" });
  await expect(
    dates.getByRole("heading", { name: /Sjösättning|Upptagning/ }).first(),
  ).toBeVisible();

  // The booking link leads to the booking page with the marina chosen.
  const link = page.getByRole("region", { name: "Bokningslänk" }).getByRole("link");
  await expect(link).toHaveText(/\/boka\/jonas-batservice\/m\/bullando-marina$/);

  // From a boat on the marina to its boat card, and back through the boat's place.
  await boats.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/batar\/[0-9a-f-]{36}$/);
  await page
    .getByRole("region", { name: "Placering" })
    .getByRole("link", { name: "Bullandö Marina" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/marinor\/[0-9a-f-]{36}$/);

  await page.goto("/boka/jonas-batservice/m/bullando-marina");
  await expect(page.getByRole("heading", { name: "Boka hos Jonas Båtservice" })).toBeVisible();

  // Sign out again: the staff test counts Elin's sessions.
  await page.goto("/marinor");
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});

test("the marina pages ask for a sign-in (step 5.3)", async ({ page }) => {
  await page.goto("/marinor");
  await expect(page).toHaveURL(/\/logga-in\?nasta=/);
});
