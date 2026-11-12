import { appUser, auditLog, connect, customer, job, visit } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { REQUEST_PHONE } from "./global-setup";
import { totp } from "./totp";

/** Mailpit, where local Supabase Auth delivers its e-mail. */
const MAILPIT = "http://127.0.0.1:54324";
const JONAS = "jonas@jonas-batservice.test"; // owner
const ELIN = "elin@jonas-batservice.test"; // mechanic
const KIM = "kim@skargardsmekarna.test"; // owner of the other firm

/** The authenticator-app secret of each owner, once added; the tests' stand-in for a phone. */
const secrets = new Map<string, string>();

interface MailpitList {
  messages?: { ID: string; Created: string }[];
}

/** The newest six-digit code sent to `email` after `since`. */
async function codeFromMail(page: Page, email: string, since: Date): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:${email}`);
        const list = (await (
          await page.request.get(`${MAILPIT}/api/v1/search?query=${query}`)
        ).json()) as MailpitList;
        const newest = (list.messages ?? []).find((m) => new Date(m.Created) >= since);
        if (!newest) return false;
        const message = (await (
          await page.request.get(`${MAILPIT}/api/v1/message/${newest.ID}`)
        ).json()) as { Text?: string; HTML?: string };
        found = /\b(\d{6})\b/.exec(`${message.Text ?? ""} ${message.HTML ?? ""}`)?.[1];
        return Boolean(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found ?? "";
}

/** The first step: the code by e-mail. */
async function emailCode(page: Page, email: string, path = "/forfragningar") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/logga-in\?nasta=/);
  const since = new Date(Date.now() - 2000);
  await page.getByLabel("E-post").fill(email);
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Om adressen finns hos oss/)).toBeVisible();
  await page.getByLabel("Kod från e-post").fill(await codeFromMail(page, email, since));
  await page.getByRole("button", { name: "Logga in" }).click();
}

/** The second step for owners: adding the app the first time, its code after that. */
async function secondFactor(page: Page, email: string) {
  const secret = secrets.get(email);
  if (secret) {
    await expect(page).toHaveURL(/\/logga-in\/tvafaktor/);
    await page.getByLabel("Kod från appen").fill(await totp(secret));
    await page.getByRole("button", { name: "Bekräfta" }).click();
    return;
  }
  await expect(page).toHaveURL(/\/sakerhet\/tvafaktor/);
  const newSecret = (await page.getByTestId("totp-secret").textContent()) ?? "";
  secrets.set(email, newSecret);
  await page.getByLabel("Kod från appen").fill(await totp(newSecret));
  await page.getByRole("button", { name: "Bekräfta" }).click();
  await expect(
    page.getByRole("list", { name: "Spara dina reservkoder" }).getByRole("listitem"),
  ).toHaveCount(10);
  await page.getByRole("button", { name: "Jag har sparat koderna" }).click();
}

async function signInOwner(page: Page, email: string, path = "/forfragningar") {
  await emailCode(page, email, path);
  await secondFactor(page, email);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test("an owner without a second factor gets no further until the app is added (step 2.8)", async ({
  page,
}) => {
  await emailCode(page, JONAS);
  // The e-mail code alone leads to adding the app, not to the requests …
  await expect(page).toHaveURL(/\/sakerhet\/tvafaktor/);
  await page.goto("/forfragningar");
  await expect(page).toHaveURL(/\/sakerhet\/tvafaktor/);
  // … and the staff routes refuse the session as well.
  const early = await page.request.post(
    "/api/bookings/00000000-0000-4000-8000-000000000000/approve",
    {
      headers: { "idempotency-key": "before-second-factor" },
    },
  );
  expect(early.status()).toBe(401);

  await secondFactor(page, JONAS);
  await expect(page).toHaveURL(/\/forfragningar$/);

  // Now the owner can approve the firm's request.
  const request = page.getByRole("listitem").filter({ hasText: "Förfrågan Kund" });
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

test("the owner blocks a mechanic, who is signed out at once and the block is logged (step 2.8)", async ({
  browser,
  page,
}) => {
  // Elin, a mechanic without an app, is signed in on her phone.
  const phone = await browser.newContext();
  const elin = await phone.newPage();
  await emailCode(elin, ELIN);
  await expect(elin).toHaveURL(/\/forfragningar$/);

  // Jonas signs in again (now with the app's code) and blocks her.
  await signInOwner(page, JONAS, "/sakerhet");
  await page.getByRole("button", { name: "Spärra inloggningar: Elin Berg" }).click();
  await expect(page.getByRole("status")).toHaveText(/spärrade/);

  // Her next click sends her back to the sign-in page.
  await elin.reload();
  await expect(elin).toHaveURL(/\/logga-in/);
  await phone.close();

  const { db, close } = connect();
  try {
    const [elinRow] = await db
      .select({ id: appUser.id })
      .from(appUser)
      .where(eq(appUser.email, ELIN));
    const logged = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "staff_sessions_revoked"),
          eq(auditLog.subjectId, elinRow?.id ?? ""),
        ),
      );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.details).toMatchObject({ sessions: 1 });
  } finally {
    await close();
  }
});

test("staff of another firm see none of its requests", async ({ page }) => {
  await signInOwner(page, KIM);
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
