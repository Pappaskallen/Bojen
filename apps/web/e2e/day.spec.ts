import { stockholmDate } from "@bojen/core";
import {
  appUser,
  attachment,
  boat,
  boatOwnership,
  connect,
  customer,
  engine,
  engineHoursReading,
  job,
  jobPart,
  serviceType,
  visit,
} from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { emailCode } from "./staff-login";

const TOR = "tor@jonas-batservice.test"; // a mechanic of their own, with one visit today
const tenantId = DEMO_TENANT_ID;
// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Tor's visit, an hour from now, so it is on today's page whatever the time of the test. */
async function seed() {
  const { db, close } = connect();
  try {
    const [tor] = await db
      .insert(appUser)
      .values({ tenantId, name: "Tor Mekaniker", role: "mechanic", email: TOR })
      .returning();
    const [service] = await db
      .select()
      .from(serviceType)
      .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Felsökning")));
    const [kund] = await db
      .insert(customer)
      .values({ tenantId, name: "Dagvy Kund", phone: "+46701740694" })
      .returning();
    const [b] = await db.insert(boat).values({ tenantId, name: "Dagbåten" }).returning();
    if (!tor || !service || !kund || !b) throw new Error("The test data was not created");
    await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: kund.id });
    const [e] = await db
      .insert(engine)
      .values({ tenantId, boatId: b.id, make: "Yamaha", model: "F150" })
      .returning();
    if (!e) throw new Error("The engine was not created");
    await db.insert(engineHoursReading).values({
      tenantId,
      engineId: e.id,
      hours: "300",
      readAt: new Date(Date.now() - 365 * 86_400_000),
      source: "mechanic",
    });
    const [j] = await db
      .insert(job)
      .values({
        tenantId,
        customerId: kund.id,
        boatId: b.id,
        serviceTypeId: service.id,
        channel: "phone",
        pipelineStatus: "booked",
        description: "Motorn hackar på tomgång.",
      })
      .returning();
    if (!j) throw new Error("The job was not created");
    // Today, an hour from now, but never across midnight.
    let start = new Date(Date.now() + 3_600_000);
    if (stockholmDate(start) !== stockholmDate(new Date()))
      start = new Date(Date.now() - 3_600_000);
    const [v] = await db
      .insert(visit)
      .values({
        tenantId,
        jobId: j.id,
        mechanicId: tor.id,
        timeWindow: `[${start.toISOString()},${new Date(start.getTime() + 3_600_000).toISOString()})`,
        plannedMinutes: 60,
        status: "booked",
      })
      .returning();
    if (!v) throw new Error("The visit was not created");
    return { visitId: v.id, jobId: j.id, engineId: e.id };
  } finally {
    await close();
  }
}

test("a mechanic starts a visit, records hours, a part and a picture, and finishes it (step 5.5a)", async ({
  page,
}) => {
  const ids = await seed();
  await emailCode(page, TOR, "/idag");
  await expect(page).toHaveURL(/\/idag$/);
  const card = page.getByRole("listitem", { name: "Dagvy Kund" });
  await expect(card).toContainText("Dagbåten");
  await expect(card).toContainText("Motorn hackar på tomgång.");
  await expect(card).toContainText("Bokad");
  await expect(page.getByText(/Körordning/)).toBeVisible();

  // Start.
  await card.getByRole("button", { name: "Starta" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Besöket är startat.");
  await expect(card).toContainText("Pågår");

  // Running hours: lower than last time is refused, higher is saved.
  await card.getByText("Gångtimmar").click();
  await card.getByLabel(/Yamaha F150/).fill("250");
  await card.getByRole("button", { name: "Spara" }).first().click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("kan inte vara lägre");
  // The refusal comes back without a reload, so the section is still open.
  await card.getByLabel(/Yamaha F150/).fill("342,5");
  await card.getByRole("button", { name: "Spara" }).first().click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Gångtimmarna är sparade.");

  // A part from the van.
  await card.getByText(/^Delar/).click();
  await card.getByLabel("Artikelnummer").fill("E2E-IMPELLER");
  await card.getByLabel("Benämning (ny del)").fill("Impeller");
  await card.getByRole("button", { name: "Lägg till del" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Delen är tillagd.");
  await card.getByText(/^Delar/).click();
  await expect(card).toContainText("Impeller (E2E-IMPELLER)");

  // A picture.
  await card.getByText(/^Bilder/).click();
  await card.getByLabel("Ta eller välj bild").setInputFiles({
    name: "impeller.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await card.getByRole("button", { name: "Ladda upp" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Bilden är sparad.");
  await expect(card).toContainText("1 bild");

  // Done: the visit is done, and so is the job's card on the pipeline.
  await card.getByRole("button", { name: "Klart" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Besöket är klart.");
  await expect(card).toContainText("Utfört");

  const { db, close } = connect();
  try {
    const [v] = await db.select({ s: visit.status }).from(visit).where(eq(visit.id, ids.visitId));
    expect(v?.s).toBe("done");
    const [j] = await db.select({ s: job.pipelineStatus }).from(job).where(eq(job.id, ids.jobId));
    expect(j?.s).toBe("done");
    const hours = await db
      .select({ h: engineHoursReading.hours, source: engineHoursReading.source })
      .from(engineHoursReading)
      .where(eq(engineHoursReading.engineId, ids.engineId));
    expect(hours).toContainEqual({ h: "342.5", source: "mechanic" });
    const parts = await db.select().from(jobPart).where(eq(jobPart.jobId, ids.jobId));
    expect(parts.map((p) => [p.status, p.source])).toEqual([["installed", "van"]]);
    const pictures = await db
      .select()
      .from(attachment)
      .where(and(eq(attachment.ownerType, "visit"), eq(attachment.ownerId, ids.visitId)));
    expect(pictures).toHaveLength(1);
  } finally {
    await close();
  }
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});
