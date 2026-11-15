import { createLocalKms } from "@bojen/adapters";
import {
  appUser,
  auditLog,
  boat,
  boatOwnership,
  boatPlacement,
  connect,
  customer,
  encryptAccess,
  engine,
  engineHoursReading,
  job,
  location,
  serviceType,
  visit,
} from "@bojen/db";
import { DEMO_MARINAS, DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { E2E_LOCAL_KMS_MASTER_KEY } from "./keys";
import { emailCode, signInOwner } from "./staff-login";

/** People of their own, so this test does not depend on what the staff tests do to Jonas and Elin. */
const MAJA = "maja@jonas-batservice.test"; // owner
const NILS = "nils@jonas-batservice.test"; // mechanic without a visit on the boat
const IDA = "ida@jonas-batservice.test"; // mechanic with a visit on the boat in two hours
const CODE = "E2E-4711#";
const KEY_LOCATION = "I kapellet vid styrpulpeten";
const tenantId = DEMO_TENANT_ID;

const range = (start: Date, minutes: number) =>
  `[${start.toISOString()},${new Date(start.getTime() + minutes * 60_000).toISOString()})`;

/** A boat with a stored code, engine hours and a visit for Ida that starts in two hours. */
async function seedBoat(): Promise<{ boatId: string; ids: Record<string, string> }> {
  const { db, close } = connect();
  try {
    const people = await db
      .insert(appUser)
      .values([
        { tenantId, name: "Maja Ägare", role: "owner", email: MAJA },
        { tenantId, name: "Nils Mekaniker", role: "mechanic", email: NILS },
        { tenantId, name: "Ida Mekaniker", role: "mechanic", email: IDA },
      ])
      .returning();
    const ids = Object.fromEntries(people.map((p) => [p.email ?? "", p.id]));
    const [marina] = await db
      .select()
      .from(location)
      .where(and(eq(location.tenantId, tenantId), eq(location.slug, DEMO_MARINAS.bullando.slug)));
    const [service] = await db
      .select()
      .from(serviceType)
      .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Felsökning")));
    const [owner] = await db
      .insert(customer)
      .values({ tenantId, name: "Kod Kund", phone: "+46701740692" })
      .returning();
    const [b] = await db
      .insert(boat)
      .values({ tenantId, name: "Kodbåten", make: "Targa", model: "28", year: 2019 })
      .returning();
    if (!marina || !service || !owner || !b) throw new Error("The test data was not created");
    await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: owner.id });
    await db.insert(boatPlacement).values({
      tenantId,
      boatId: b.id,
      locationId: marina.id,
      season: "winter",
      mode: "land",
      haulOutDate: "2026-01-01",
      launchDate: "2027-12-31",
    });
    const [e] = await db
      .insert(engine)
      .values({ tenantId, boatId: b.id, make: "Volvo Penta", model: "D4-300" })
      .returning();
    if (!e) throw new Error("The engine was not created");
    await db.insert(engineHoursReading).values([
      {
        tenantId,
        engineId: e.id,
        hours: "210",
        readAt: new Date("2025-05-01T10:00:00Z"),
        source: "mechanic",
      },
      {
        tenantId,
        engineId: e.id,
        hours: "265.5",
        readAt: new Date("2026-05-01T10:00:00Z"),
        source: "customer",
      },
    ]);
    // The same master key as the web server in playwright.config.ts.
    await encryptAccess(
      {
        db,
        kms: createLocalKms(Buffer.from(E2E_LOCAL_KMS_MASTER_KEY, "base64")),
        now: () => new Date(),
      },
      { tenantId, boatId: b.id, code: CODE, keyLocation: KEY_LOCATION },
    );
    // Ida's visit, put in directly: it starts in two hours, whatever the time of the test.
    const [j] = await db
      .insert(job)
      .values({
        tenantId,
        customerId: owner.id,
        boatId: b.id,
        serviceTypeId: service.id,
        channel: "phone",
      })
      .returning();
    if (!j) throw new Error("The job was not created");
    await db.insert(visit).values({
      tenantId,
      jobId: j.id,
      mechanicId: ids[IDA],
      timeWindow: range(new Date(Date.now() + 2 * 3_600_000), 60),
      plannedMinutes: 60,
      status: "booked",
    });
    return { boatId: b.id, ids };
  } finally {
    await close();
  }
}

async function logged(boatId: string) {
  const { db, close } = connect();
  try {
    return await db
      .select({ userId: auditLog.userId, action: auditLog.action, details: auditLog.details })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, tenantId),
          eq(auditLog.subjectType, "boat"),
          eq(auditLog.subjectId, boatId),
        ),
      );
  } finally {
    await close();
  }
}

async function showAccess(page: Page) {
  const access = page.getByRole("region", { name: "Åtkomst", exact: true });
  await access.getByRole("button", { name: "Visa åtkomst" }).click();
  await expect(access.getByText("Visningen loggas med ditt namn och tid.")).toBeVisible();
  await access.getByRole("button", { name: "Ja, visa" }).click();
  return access;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);
}

test("the boat card shows the code to the owner after a confirmation, not to a mechanic without a visit, and logs both (step 5.2)", async ({
  browser,
  page,
}) => {
  const { boatId, ids } = await seedBoat();
  const path = `/batar/${boatId}`;

  // --- Nils, a mechanic without a visit on the boat, sees the card but not the code. ---
  await emailCode(page, NILS, path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.getByRole("heading", { name: "Kodbåten", level: 1 })).toBeVisible();
  await expect(page.getByText("Targa 28")).toBeVisible();
  // The hours, drawn and as a table.
  await expect(page.getByRole("img", { name: "Gångtimmar" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Alla mätningar" })).toContainText("265.5");
  // The page says a code is stored, and nowhere what it is.
  const access = page.getByRole("region", { name: "Åtkomst", exact: true });
  await expect(access).toContainText("Sparad");
  expect(await page.content()).not.toContain(CODE);
  expect(await page.content()).not.toContain(KEY_LOCATION);

  await showAccess(page);
  await expect(access.getByRole("alert")).toContainText("Du kan bara se koden för dina egna besök");
  await expect(page.getByText(CODE)).toHaveCount(0);
  // The route refuses him as well, whatever the page does.
  const direct = await page.request.post(`/api/batar/${boatId}/atkomst`, {
    data: { confirm: true },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(direct.status()).toBe(403);
  await signOut(page);

  // --- Maja, the owner: Avbryt shows nothing, Ja, visa shows the code, and both are logged. ---
  await signInOwner(page, MAJA, path);
  const ownAccess = page.getByRole("region", { name: "Åtkomst", exact: true });
  await ownAccess.getByRole("button", { name: "Visa åtkomst" }).click();
  await ownAccess.getByRole("button", { name: "Avbryt" }).click();
  await expect(page.getByText(CODE)).toHaveCount(0);
  const shown = await showAccess(page);
  await expect(shown.getByText(CODE)).toBeVisible();
  await expect(shown.getByText(KEY_LOCATION)).toBeVisible();
  await expect(shown.getByText(/Döljs om \d+ s/)).toBeVisible();
  // Hidden again on request; the code is gone from the page.
  await shown.getByRole("button", { name: "Dölj nu" }).click();
  await expect(page.getByText(CODE)).toHaveCount(0);
  await signOut(page);

  // --- Ida, the mechanic with the visit, may see it, from another phone. ---
  const phone = await browser.newContext();
  const ida = await phone.newPage();
  await emailCode(ida, IDA, path);
  await expect((await showAccess(ida)).getByText(CODE)).toBeVisible();
  await signOut(ida);
  await phone.close();

  // Every attempt is in the log, against the boat, with who and why; no code in it.
  const rows = await logged(boatId);
  expect(rows).toEqual(
    expect.arrayContaining([
      { userId: ids[NILS], action: "access_code_denied", details: { reason: "not_assigned" } },
      { userId: ids[MAJA], action: "access_code_viewed", details: { reason: "owner" } },
      expect.objectContaining({
        userId: ids[IDA],
        action: "access_code_viewed",
        details: expect.objectContaining({ reason: "assigned_mechanic" }),
      }),
    ]),
  );
  // Nils twice (the button and the direct request), Maja once (not for Avbryt), Ida once.
  expect(rows).toHaveLength(4);
  expect(JSON.stringify(rows)).not.toContain(CODE);
});
