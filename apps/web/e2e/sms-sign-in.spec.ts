import { connect, message } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { FAKE_ELKS_URL, type FakeElksSms } from "./fake-elks";

/**
 * Staff sign-in with a code by sms (byggplan step 3.1). The real local Supabase Auth makes
 * the code and calls our sms hook, which sends it with the 46elks adapter to the fake 46elks.
 */
const ELIN_MOBILE = "+46701740696"; // Elin Berg, mechanic, in the demo data

async function sentTo(page: Page, to: string): Promise<FakeElksSms[]> {
  const all = (await (await page.request.get(`${FAKE_ELKS_URL}/sent`)).json()) as FakeElksSms[];
  return all.filter((s) => s.to === to);
}

test("a mechanic signs in with a code by sms (step 3.1)", async ({ page }) => {
  const before = (await sentTo(page, ELIN_MOBILE)).length;
  await page.goto("/forfragningar");
  await expect(page).toHaveURL(/\/logga-in\?nasta=/);
  await page.getByLabel("Sms").check();
  await page.getByLabel("Mobilnummer").fill("070-174 06 96");
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Om numret finns hos oss/)).toBeVisible();

  let code = "";
  await expect
    .poll(async () => {
      const sms = (await sentTo(page, ELIN_MOBILE)).slice(before);
      code =
        /^(\d{6}) är din kod för att logga in i Bojen\./.exec(sms.at(-1)?.message ?? "")?.[1] ?? "";
      return code.length;
    })
    .toBe(6);

  await page.getByLabel("Kod från sms").fill(code);
  await page.getByRole("button", { name: "Logga in" }).click();
  await expect(page).toHaveURL(/\/forfragningar$/);
  await expect(page.getByRole("heading", { name: "Förfrågningar" })).toBeVisible();

  // Logged as sent, without the code.
  const { db, close } = connect();
  try {
    const rows = await db
      .select()
      .from(message)
      .where(and(eq(message.tenantId, DEMO_TENANT_ID), eq(message.template, "staff_sign_in_code")));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({ toAddress: ELIN_MOBILE, status: "sent", body: null });
    }
    expect(JSON.stringify(rows)).not.toContain(code);
  } finally {
    await close();
  }

  // Signing out ends the session in Supabase Auth too, so no session of Elin's is left over.
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in$/);
});

test("an unknown number gets the same answer and no sms", async ({ page }) => {
  await page.goto("/logga-in");
  await page.getByLabel("Sms").check();
  await page.getByLabel("Mobilnummer").fill("070-174 06 99");
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Om numret finns hos oss/)).toBeVisible();
  expect(await sentTo(page, "+46701740699")).toHaveLength(0);
});
