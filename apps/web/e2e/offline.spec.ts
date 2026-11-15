import { stockholmDate } from "@bojen/core";
import {
  appUser,
  attachment,
  boat,
  boatOwnership,
  connect,
  customer,
  domainEvent,
  job,
  serviceReport,
  serviceType,
  visit,
} from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { createSupabaseStorage } from "@bojen/adapters";
import { E2E_TRANSCRIPT, LOCAL_SUPABASE_SERVICE_ROLE_KEY, LOCAL_SUPABASE_URL } from "./keys";
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
    // A picture of the boat, so the mechanic sees which boat it is (step 5.5d).
    const key = `${tenantId}/boats/${b.id}/skarbaten.png`;
    await createSupabaseStorage({
      url: LOCAL_SUPABASE_URL,
      serviceRoleKey: LOCAL_SUPABASE_SERVICE_ROLE_KEY,
      bucket: "attachments",
    }).put(key, PNG, "image/png");
    await db.insert(attachment).values({
      tenantId,
      ownerType: "boat",
      ownerId: b.id,
      storageKey: key,
      contentType: "image/png",
      sizeBytes: PNG.byteLength,
    });
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

test("without coverage the mechanic finishes a visit with a picture, a note and a voice note; it all goes when the network is back, and the report draft is written (steps 5.5b and 5.5d)", async ({
  page,
  context,
}) => {
  // Sign-in, four changes without coverage, the sync, the draft from the worker and the
  // approval: more than the default minute on a slow runner.
  test.setTimeout(150_000);
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
  // The boat's picture is at the top, kept on the phone with the day view.
  const boatPicture = card.getByRole("img", { name: "Bild på Skärbåten" });
  await expect(boatPicture).toBeVisible();
  await expect
    .poll(() => boatPicture.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

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

  // A voice note, from the phone's recorder app (the microphone button does the same).
  await card.getByText(/^Röstanteckning/).click();
  await card.getByLabel("Spela in eller välj ljudfil").setInputFiles({
    name: "rost.webm",
    mimeType: "audio/webm",
    buffer: Buffer.from("not really opus, but the fake speech to text does not mind"),
  });
  await card.getByRole("button", { name: "Spara röstanteckning" }).click();
  await expect(page.getByText("3 ändringar väntar på täckning.")).toBeVisible();

  await card.getByRole("button", { name: "Klart" }).click();
  await expect(page.getByText("4 ändringar väntar på täckning.")).toBeVisible();

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
    const files = await db
      .select({ type: attachment.contentType })
      .from(attachment)
      .where(and(eq(attachment.ownerType, "visit"), eq(attachment.ownerId, visitId)));
    expect(files.map((f) => f.type).sort()).toEqual(["audio/webm", "image/png"]);

    // --- The report draft is written from the note and the voice note (step 5.5d). ---
    // The worker writes it: wait in the database, and say what the job ran into if it does not.
    const draftState = async () => {
      const [r] = await db
        .select({ status: serviceReport.status })
        .from(serviceReport)
        .where(eq(serviceReport.visitId, visitId));
      const jobs = await db.execute<{ attempts: number; last_error: string | null }>(
        sql`select attempts, last_error from graphile_worker._private_jobs
            where key = ${`report:${visitId}`}`,
      );
      const job = [...jobs][0];
      return job
        ? `${r?.status ?? "none"} (job: ${String(job.attempts)} attempts, ${job.last_error ?? "no error"})`
        : (r?.status ?? "none");
    };
    await expect.poll(draftState, { timeout: 45_000, intervals: [500] }).toBe("draft");
    await page.reload();
    const synced = page.getByRole("listitem", { name: "Offline Kund" });
    await expect(synced.getByText("Rapportutkast klart")).toBeVisible();
    await synced.getByRole("link", { name: "Granska rapporten" }).click();
    await expect(page.getByRole("heading", { name: "Servicerapport", level: 1 })).toBeVisible();
    const workDone = page.getByLabel("En punkt per rad.");
    await expect(workDone).toHaveValue(/Bytt drevolja/);
    await expect(workDone).toHaveValue(/Bälgen ser sliten ut/);
    await expect(workDone).toHaveValue(new RegExp(E2E_TRANSCRIPT.replace(/\.$/, "")));
    await expect(page.getByText(E2E_TRANSCRIPT)).toBeVisible();

    // The mechanic adds a recommendation, and the invoice basis has the price list's lines.
    await page.getByLabel("Rekommendation 1").fill("Byt bälgen före sjösättningen");
    await page.getByLabel("Prioritet").first().selectOption({ label: "Åtgärda nu" });
    const invoice = page.getByRole("region", { name: "Fakturaunderlag" });
    await expect(invoice).toContainText("Felsökning");
    await expect(invoice).toContainText("Framkörning");
    await expect(invoice).toContainText("Totalt inkl. moms");

    await page.getByRole("button", { name: "Godkänn och skicka till kunden" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Rapporten är godkänd och skickas till kunden.",
    );
    await expect(page.getByLabel("En punkt per rad.")).toHaveAttribute("readonly", "");

    // Approved: the event that sends it to the customer (F7), with the recommendation.
    const [approved] = await db
      .select({ payload: domainEvent.payload })
      .from(domainEvent)
      .where(and(eq(domainEvent.aggregateId, visitId), eq(domainEvent.type, "report.approved")));
    expect(approved?.payload).toMatchObject({
      visitId,
      recommendations: "- Åtgärda nu: Byt bälgen före sjösättningen",
    });
    const [report] = await db
      .select({ status: serviceReport.status, invoice: serviceReport.invoice })
      .from(serviceReport)
      .where(eq(serviceReport.visitId, visitId));
    expect(report?.status).toBe("approved");
    expect(report?.invoice?.grossOre).toBeGreaterThan(0);
    await page.goto("/idag");
  } finally {
    await close();
  }
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});
