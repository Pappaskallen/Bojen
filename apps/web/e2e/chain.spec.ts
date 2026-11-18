import { stockholmDate } from "@bojen/core";
import { appUser, connect, customer, job, survey, tenant, visit } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { chainWorker } from "./chain-worker";
import { FAKE_ELKS_URL, type FakeElksSms } from "./fake-elks";
import { emailCode, signInOwner } from "./staff-login";

/**
 * The whole chain before the pilot (byggplan, Avslutande kontroll): booking on the web →
 * confirmation → the 24-hour check answered JA → the day view without coverage → Klart →
 * report → the satisfaction question answered 5 → the review link.
 *
 * What the customer and the staff do on a screen goes through the web app. What the worker does
 * in between runs in this process (`chainWorker`), for this visit only, with the sms through the
 * real 46elks adapter to the fake 46elks. The customer's sms answers come in at the worker's
 * time, which runs ahead of the web server's (see chain-worker.ts).
 */
const tenantId = DEMO_TENANT_ID;
const OWNER = "kedja@jonas-batservice.test";
const MECHANIC = "kim@jonas-batservice.test";
const NAME = "Kedja Kundsson";
const PHONE = "+46701740698";
/** The firm's sms number, which the customer answers (PTS range for fiction). */
const FIRM_NUMBER = "+46766860010";
/** The firm's review page; the test reads the redirect and never goes there. */
const REVIEW = "https://g.page/r/jonas-batservice/review";

test.beforeAll(async () => {
  const { db, close } = connect();
  try {
    await db.insert(appUser).values([
      { tenantId, name: "Kedja Ägare", role: "owner", email: OWNER },
      { tenantId, name: "Kim Mekaniker", role: "mechanic", email: MECHANIC },
    ]);
    // The firm's own sms number and review page, which the demo data does not have.
    await db
      .update(tenant)
      .set({
        settings: sql`${tenant.settings} || ${JSON.stringify({
          sms: { from: FIRM_NUMBER },
          reviewUrl: REVIEW,
        })}::jsonb`,
      })
      .where(eq(tenant.id, tenantId));
  } finally {
    await close();
  }
});

test.afterAll(async () => {
  const { db, close } = connect();
  try {
    await db
      .update(tenant)
      .set({ settings: sql`${tenant.settings} - 'sms' - 'reviewUrl'` })
      .where(eq(tenant.id, tenantId));
  } finally {
    await close();
  }
});

/** What the fake 46elks has "sent" to the customer, oldest first. */
async function smsToCustomer(request: APIRequestContext): Promise<string[]> {
  const sent = (await (await request.get(`${FAKE_ELKS_URL}/sent`)).json()) as FakeElksSms[];
  return sent.filter((s) => s.to === PHONE).map((s) => s.message);
}

test("a booking on the web goes all the way to the review link (before the pilot)", async ({
  page,
  context,
}) => {
  // Two sign-ins, the day without coverage, the report draft and six sms.
  test.setTimeout(240_000);
  const { db, close } = connect();
  try {
    const sent = () => smsToCustomer(page.request);
    const last = async () => (await sent()).at(-1) ?? "";

    // --- 1. The customer books winter lay-up at Bullandö on the web. ---
    await page.goto("/boka/jonas-batservice/m/bullando-marina");
    await page.getByRole("radio", { name: /Vinterkonservering/ }).check();
    await page.getByRole("button", { name: "Nästa" }).click();
    await page.getByLabel("Ditt namn").fill(NAME);
    await page.getByLabel("Mobilnummer").fill("070-174 06 98");
    await page.getByLabel("Båtmärke").fill("Nimbus");
    await page.getByLabel("Modell", { exact: true }).fill("305 Coupé");
    await page.getByRole("button", { name: "Nästa" }).click();
    await expect(page.getByLabel("Välj plats")).not.toHaveValue("");
    await page.getByRole("radio", { name: "På land" }).check();
    await page.getByRole("button", { name: "Nästa" }).click();
    // A marina day, a week ahead: far enough for the check the day before.
    await page
      .locator("label.choice")
      .filter({ hasText: "Mekanikern är på Bullandö Marina denna dag" })
      .first()
      .getByRole("radio")
      .check();
    await page.getByRole("button", { name: "Nästa" }).click();
    await page.getByRole("button", { name: "Nästa" }).click(); // no pictures
    await page.getByRole("button", { name: "Skicka bokningen" }).click();
    await expect(page.getByText(/Vi har tagit emot din bokning/)).toBeVisible();

    const [booked] = await db
      .select({ visitId: visit.id, status: visit.status, jobId: job.id })
      .from(visit)
      .innerJoin(job, eq(job.id, visit.jobId))
      .innerJoin(customer, eq(customer.id, job.customerId))
      .where(and(eq(customer.tenantId, tenantId), eq(customer.phone, PHONE)));
    expect(booked?.status).toBe("pending_approval");
    const visitId = booked?.visitId ?? "";
    const worker = chainWorker(db, visitId, "http://127.0.0.1:3100");
    const status = async () =>
      (await db.select({ s: visit.status }).from(visit).where(eq(visit.id, visitId)))[0]?.s;

    // --- 2. The owner approves the request; the customer gets the confirmation (F1). ---
    await signInOwner(page, OWNER, "/forfragningar");
    const request = page.getByRole("listitem").filter({ hasText: NAME });
    await request.getByRole("button", { name: "Godkänn" }).click();
    await expect(request.getByRole("status")).toHaveText("Godkänd. Kunden får en bekräftelse.");
    expect(await status()).toBe("booked");
    await worker.run();
    const confirmation = await last();
    expect(confirmation).toMatch(/^Hej Kedja! Bokat: Vinterkonservering .+, Bullandö[^.]*\./);
    expect(confirmation).toMatch(/Ändra\/avboka: 127\.0\.0\.1:3100\/x\/[A-Za-z0-9]{8} /);

    // --- 3. The day before: the availability check (F3), and the customer answers JA. ---
    const checkAt = await worker.next("visit_check");
    expect(checkAt).not.toBeNull();
    expect(await worker.run(checkAt ?? undefined)).toContain("visit_check");
    expect(await last()).toContain("kommer vi till Nimbus 305 Coupé");
    const answer = (body: string, id: string) =>
      worker.answer({ from: PHONE, to: FIRM_NUMBER, body, id });
    expect(await answer("JA", "e2e-chain-ja")).toMatchObject({ status: "received" });
    await worker.run();
    expect(await last()).toBe(
      "Tack! Bokningen är bekräftad. Du får ungefärlig tid i morgon bitti.",
    );
    expect(await status()).toBe("confirmed");

    // --- The day comes. The server's clock cannot be moved, so the visit moves to today,
    // to a mechanic of the test's own, and the worker's clock comes back to the real one. ---
    const [kim] = await db
      .select({ id: appUser.id })
      .from(appUser)
      .where(and(eq(appUser.tenantId, tenantId), eq(appUser.email, MECHANIC)));
    let start = new Date(Date.now() + 3_600_000);
    if (stockholmDate(start) !== stockholmDate(new Date()))
      start = new Date(Date.now() - 3_600_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    await db
      .update(visit)
      .set({
        mechanicId: kim?.id ?? "",
        timeWindow: `[${start.toISOString()},${end.toISOString()})`,
      })
      .where(eq(visit.id, visitId));
    worker.backToNow();

    // --- 4. The mechanic starts, then finishes without coverage. ---
    await context.clearCookies();
    await emailCode(page, MECHANIC, "/idag");
    await expect(page).toHaveURL(/\/idag$/);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    const card = page.getByRole("listitem", { name: NAME });
    await card.getByRole("button", { name: "Starta" }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText("Besöket är startat.");
    // Loaded once more with coverage, so the phone keeps the day as it is now.
    await page.reload();
    await expect(card).toContainText("Pågår");

    await context.setOffline(true);
    await page.reload();
    const offline = page.getByRole("listitem", { name: NAME });
    await offline.getByText("Anteckning", { exact: true }).click();
    await offline
      .getByLabel("Det du skriver här blir underlag för rapporten.")
      .fill("Motorn konserverad. Impellern bytt.");
    await offline.getByRole("button", { name: "Spara anteckning" }).click();
    await offline.getByRole("button", { name: "Klart" }).click();
    await expect(page.getByText("2 ändringar väntar på täckning.")).toBeVisible();
    expect(await status()).toBe("in_progress");

    await context.setOffline(false);
    await expect(page.getByRole("main").getByRole("status").first()).toHaveText(
      "Allt som väntade är skickat.",
      { timeout: 20_000 },
    );
    expect(await status()).toBe("done");

    // --- 5. The report: the draft from the note, approved and sent to the customer (F7). ---
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.getByRole("link", { name: "Granska rapporten" }).count();
        },
        { timeout: 45_000, intervals: [1_000] },
      )
      .toBe(1);
    await page.getByRole("link", { name: "Granska rapporten" }).click();
    await expect(page.getByLabel("En punkt per rad.")).toHaveValue(/Impellern bytt/);
    await page.getByRole("button", { name: "Godkänn och skicka till kunden" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Rapporten är godkänd och skickas till kunden.",
    );
    await worker.run();
    expect(await sent()).toContainEqual(
      expect.stringMatching(/^Klart! Vinterkonservering på Nimbus 305 Coupé är utförd\./),
    );

    // --- 6. The satisfaction question 18 hours later (F9); the customer answers 5. ---
    const surveyAt = await worker.next("visit_survey");
    expect(surveyAt).not.toBeNull();
    await worker.run(surveyAt ?? undefined);
    expect(await last()).toMatch(/^Hur nöjd är du med servicen i går\?/);
    expect(await answer("5", "e2e-chain-5")).toMatchObject({ status: "received" });
    await worker.run();
    const thanks = await last();
    expect(thanks).toMatch(
      /^Tack, vad glad jag blir! .+ En recension tar 30 sek: 127\.0\.0\.1:3100\/r\/[A-Za-z0-9]{8} \/Kim$/,
    );

    // --- 7. The review link counts the click and goes on to the firm's review page. ---
    const code = /\/r\/([A-Za-z0-9]{8})/.exec(thanks)?.[1] ?? "";
    const review = await page.request.get(`/r/${code}`, { maxRedirects: 0 });
    expect(review.status()).toBe(302);
    expect(review.headers().location).toBe(REVIEW);
    const [stored] = await db.select().from(survey).where(eq(survey.visitId, visitId));
    expect(stored?.score).toBe(5);
    expect(stored?.reviewLinkClickedAt).not.toBeNull();

    // Every step reached the customer, in order.
    const steps = (await sent()).map((s) => s.split(" ").slice(0, 2).join(" "));
    expect(steps).toEqual([
      "Hej Kedja!", // F1
      "Hej Kedja!", // F3
      "Tack! Bokningen",
      "Klart! Vinterkonservering",
      "Hur nöjd",
      "Tack, vad",
    ]);
    await worker.clear();
  } finally {
    await close();
  }
});
