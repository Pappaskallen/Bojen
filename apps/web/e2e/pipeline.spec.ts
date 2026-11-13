import { appUser, connect, customer, domainEvent, job, serviceType } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { emailCode, signInOwner } from "./staff-login";

/** People of their own, independent of the staff tests. */
const OLA = "ola@jonas-batservice.test"; // owner
const SIV = "siv@jonas-batservice.test"; // mechanic without visits
const tenantId = DEMO_TENANT_ID;

/** A job waiting as an inquiry, with no visit yet. */
async function seedJob() {
  const { db, close } = connect();
  try {
    const people = await db
      .insert(appUser)
      .values([
        { tenantId, name: "Ola Ägare", role: "owner", email: OLA },
        { tenantId, name: "Siv Mekaniker", role: "mechanic", email: SIV },
      ])
      .returning();
    const [service] = await db
      .select()
      .from(serviceType)
      .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Felsökning")));
    const [kund] = await db
      .insert(customer)
      .values({ tenantId, name: "Pipeline Kund", phone: "+46701740693" })
      .returning();
    if (!kund || !service) throw new Error("The test data was not created");
    const [j] = await db
      .insert(job)
      .values({ tenantId, customerId: kund.id, serviceTypeId: service.id, channel: "phone" })
      .returning();
    const ola = people.find((p) => p.email === OLA);
    if (!j || !ola) throw new Error("The job was not created");
    return { jobId: j.id, ola: ola.id };
  } finally {
    await close();
  }
}

async function statusOf(jobId: string) {
  const { db, close } = connect();
  try {
    return (await db.select({ s: job.pipelineStatus }).from(job).where(eq(job.id, jobId)))[0]?.s;
  } finally {
    await close();
  }
}

test("staff drag a card between columns, and a mechanic cannot move others' jobs (step 5.4)", async ({
  page,
}) => {
  const { jobId, ola } = await seedJob();
  const card = page.locator(`li.card[data-job="${jobId}"]`);
  const column = (name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

  // --- Siv, a mechanic without a visit on the job, sees the card but cannot move it. ---
  await emailCode(page, SIV, "/pipeline");
  await expect(page).toHaveURL(/\/pipeline$/);
  await expect(column("Förfrågan").locator(`li.card[data-job="${jobId}"]`)).toBeVisible();
  await expect(card).toHaveAttribute("draggable", "false");
  await expect(card.getByRole("combobox")).toHaveCount(0);
  const refused = await page.request.post(`/api/pipeline/${jobId}`, {
    data: { to: "quote" },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(refused.status()).toBe(403);
  expect(await statusOf(jobId)).toBe("inquiry");
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);

  // --- Ola, the owner, drags it to Offert, and it stays there after a reload. ---
  await signInOwner(page, OLA, "/pipeline");
  // The tests run as a phone, where Playwright's mouse drag sends no drag events (phones have
  // no HTML drag and drop, which is why the card also has its list). The events are sent
  // directly instead, so the board's own drag handlers are what is tested.
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent("dragstart", { dataTransfer: transfer });
  await column("Offert").dispatchEvent("dragover", { dataTransfer: transfer });
  await column("Offert").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("status")).toHaveText("Flyttat till Offert.");
  await expect(column("Offert").locator(`li.card[data-job="${jobId}"]`)).toBeVisible();
  await expect.poll(() => statusOf(jobId)).toBe("quote");
  await page.reload();
  await expect(column("Offert").locator(`li.card[data-job="${jobId}"]`)).toBeVisible();

  // The list on the card moves it too, without a mouse.
  await card.getByRole("combobox").selectOption({ label: "Delar beställda" });
  await expect(column("Delar beställda").locator(`li.card[data-job="${jobId}"]`)).toBeVisible();
  await expect.poll(() => statusOf(jobId)).toBe("parts_ordered");

  // Every move is recorded, with who made it.
  const { db, close } = connect();
  try {
    const moves = await db
      .select({ payload: domainEvent.payload, actorId: domainEvent.actorId })
      .from(domainEvent)
      .where(and(eq(domainEvent.aggregateId, jobId), eq(domainEvent.type, "job.pipeline_moved")));
    expect(moves).toEqual(
      expect.arrayContaining([
        { payload: { from: "inquiry", to: "quote", why: "manual" }, actorId: ola },
        { payload: { from: "quote", to: "parts_ordered", why: "manual" }, actorId: ola },
      ]),
    );
  } finally {
    await close();
  }
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
});
