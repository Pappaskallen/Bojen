import { connect, customer, job, visit } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { REQUEST_PHONE } from "./global-setup";

/** Mailpit, where local Supabase Auth delivers its e-mail. */
const MAILPIT = "http://127.0.0.1:54324";

interface MailpitList {
  messages?: { ID: string; Created: string; To?: { Address: string }[] }[];
}

/** The newest six-digit code sent to `email` after `since`. */
async function codeFromMail(page: Page, email: string, since: Date): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (
          await page.request.get(
            `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
          )
        ).json()) as MailpitList;
        const newest = (list.messages ?? []).find((m) => new Date(m.Created) >= since);
        if (!newest) return false;
        const message = (await (
          await page.request.get(`${MAILPIT}/api/v1/message/${newest.ID}`)
        ).json()) as {
          Text?: string;
          HTML?: string;
        };
        found = /\b(\d{6})\b/.exec(`${message.Text ?? ""} ${message.HTML ?? ""}`)?.[1];
        return Boolean(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found ?? "";
}

async function signIn(page: Page, email: string) {
  await page.goto("/forfragningar");
  await expect(page).toHaveURL(
    /\/logga-in\?nasta=%2Fforfragningar|\/logga-in\?nasta=\/forfragningar/,
  );
  const since = new Date(Date.now() - 2000);
  await page.getByLabel("E-post").fill(email);
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Om adressen finns hos oss/)).toBeVisible();
  await page.getByLabel("Kod från e-post").fill(await codeFromMail(page, email, since));
  await page.getByRole("button", { name: "Logga in" }).click();
  await expect(page).toHaveURL(/\/forfragningar$/);
}

test("a mechanic signs in with an e-mail code, sees the firm's request and approves it", async ({
  page,
}) => {
  await signIn(page, "jonas@jonas-batservice.test");
  const request = page.getByRole("listitem").filter({ hasText: "Förfrågan Kund" });
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Godkänn" }).click();
  await expect(request.getByRole("status")).toHaveText(/Godkänd/);

  const { db, close } = connect();
  try {
    const rows = await db
      .select({ status: visit.status })
      .from(visit)
      .innerJoin(job, eq(job.id, visit.jobId))
      .innerJoin(customer, eq(customer.id, job.customerId))
      .where(and(eq(customer.tenantId, DEMO_TENANT_ID), eq(customer.phone, REQUEST_PHONE)));
    expect(rows.map((r) => r.status)).toEqual(["booked"]);
  } finally {
    await close();
  }
});

test("staff of another firm see none of its requests", async ({ page }) => {
  await signIn(page, "kim@skargardsmekarna.test");
  await expect(page.getByText("Inga förfrågningar just nu.")).toBeVisible();
  await expect(page.getByText("Förfrågan Kund")).toHaveCount(0);
});

test("an unknown address gets the same answer and no mail", async ({ page }) => {
  await page.goto("/logga-in");
  await page.getByLabel("E-post").fill("okand@exempel.test");
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Om adressen finns hos oss/)).toBeVisible();
  const list = (await (
    await page.request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:okand@exempel.test")}`,
    )
  ).json()) as MailpitList;
  expect(list.messages ?? []).toHaveLength(0);
});

test("the staff routes answer 401 without sign-in", async ({ request }) => {
  const response = await request.post(
    "/api/bookings/00000000-0000-4000-8000-000000000000/approve",
    {
      headers: { "idempotency-key": "no-sign-in" },
    },
  );
  expect(response.status()).toBe(401);
});
