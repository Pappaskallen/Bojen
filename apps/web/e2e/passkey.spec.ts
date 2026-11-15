import { createLocalKms } from "@bojen/adapters";
import { stockholmDate } from "@bojen/core";
import {
  appUser,
  auditLog,
  boat,
  boatOwnership,
  connect,
  customer,
  encryptAccess,
  job,
  serviceType,
  visit,
} from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { E2E_LOCAL_KMS_MASTER_KEY } from "./keys";
import { emailCode } from "./staff-login";

/**
 * Passkeys only work on a host name, never on an IP address such as 127.0.0.1, so this test
 * uses localhost. The cookies there are its own, so the sign-in starts from scratch.
 */
const HOST = "http://localhost:3100";
const VERA = "vera@jonas-batservice.test"; // a mechanic with a visit in two hours
const CODE = "PASS-2580#";
const KEY_LOCATION = "Under dynan i sittbrunnen";
const tenantId = DEMO_TENANT_ID;

async function seed() {
  const { db, close } = connect();
  try {
    const [vera] = await db
      .insert(appUser)
      .values({ tenantId, name: "Vera Mekaniker", role: "mechanic", email: VERA })
      .returning();
    const [service] = await db
      .select()
      .from(serviceType)
      .where(and(eq(serviceType.tenantId, tenantId), eq(serviceType.name, "Felsökning")));
    const [kund] = await db
      .insert(customer)
      .values({ tenantId, name: "Passkey Kund", phone: "+46701740696" })
      .returning();
    const [b] = await db.insert(boat).values({ tenantId, name: "Nyckelbåten" }).returning();
    if (!vera || !service || !kund || !b) throw new Error("The test data was not created");
    await db.insert(boatOwnership).values({ tenantId, boatId: b.id, customerId: kund.id });
    await encryptAccess(
      {
        db,
        kms: createLocalKms(Buffer.from(E2E_LOCAL_KMS_MASTER_KEY, "base64")),
        now: () => new Date(),
      },
      { tenantId, boatId: b.id, code: CODE, keyLocation: KEY_LOCATION },
    );
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
    let start = new Date(Date.now() + 2 * 3_600_000);
    if (stockholmDate(start) !== stockholmDate(new Date()))
      start = new Date(Date.now() - 3_600_000);
    const [v] = await db
      .insert(visit)
      .values({
        tenantId,
        jobId: j.id,
        mechanicId: vera.id,
        timeWindow: `[${start.toISOString()},${new Date(start.getTime() + 3_600_000).toISOString()})`,
        plannedMinutes: 60,
        status: "in_progress",
      })
      .returning();
    if (!v) throw new Error("The visit was not created");
    return { visitId: v.id, veraId: vera.id };
  } finally {
    await close();
  }
}

/** What IndexedDB on the phone holds for the visit's codes, as text, or null. */
const storedCodes = (page: Page, visitId: string) =>
  page.evaluate(
    (id) =>
      new Promise<string | null>((resolve) => {
        const request = indexedDB.open("bojen-codes", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("codes", { keyPath: "visitId" });
        request.onsuccess = () => {
          const get = request.result.transaction("codes").objectStore("codes").get(id);
          get.onsuccess = () => {
            const item = get.result as { data: ArrayBuffer } | undefined;
            resolve(item ? new TextDecoder("latin1").decode(item.data) : null);
          };
        };
      }),
    visitId,
  );

test("a mechanic adds a passkey, signs in with it, unlocks the day view and sees the code only on request (step 5.5c)", async ({
  page,
  context,
}) => {
  const { visitId, veraId } = await seed();
  // A phone with Face ID: a virtual authenticator with user verification and PRF.
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });

  // --- The first time with an e-mail code, then a passkey on the security page. ---
  await emailCode(page, VERA, `${HOST}/sakerhet`);
  await expect(page).toHaveURL(`${HOST}/sakerhet`);
  await page.getByRole("button", { name: "Lägg till passkey på den här telefonen" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "Klart. Passkeyn är sparad och kan skydda koderna på telefonen.",
  );
  await page.getByRole("button", { name: "Logga ut" }).click();
  await expect(page).toHaveURL(/\/logga-in/);

  // --- Signing in with the passkey: no code. ---
  // From here the clock is the test's (time still runs), so the 60 seconds can pass at once.
  await page.clock.install();
  await page.goto(`${HOST}/idag`);
  await expect(page).toHaveURL(/\/logga-in\?nasta=%2Fidag/);
  await page.getByRole("button", { name: "Logga in med passkey" }).click();
  await expect(page).toHaveURL(`${HOST}/idag`);

  // --- The day view is locked: nothing of the day, and no code, until the unlock. ---
  await expect(page.getByRole("dialog", { name: "Dagvyn är låst" })).toBeVisible();
  await expect(page.getByText("Passkey Kund")).toHaveCount(0);
  expect(await page.content()).not.toContain(CODE);
  await page.getByRole("button", { name: "Lås upp" }).click();
  const card = page.getByRole("listitem", { name: "Passkey Kund" });
  await expect(card).toBeVisible();

  // The codes come to the phone, encrypted, but are not on the screen.
  await expect(
    card.getByText("Koderna finns krypterade på telefonen, även utan täckning."),
  ).toBeVisible();
  await expect(card.getByText(CODE)).toHaveCount(0);
  const sealed = await storedCodes(page, visitId);
  expect(sealed).not.toBeNull();
  expect(sealed).not.toContain(CODE);
  expect(sealed).not.toContain(KEY_LOCATION);

  // Shown on request, then hidden again after 60 seconds.
  await card.getByRole("button", { name: "Visa kod och nyckel" }).click();
  await expect(card.getByText(CODE)).toBeVisible();
  await expect(card.getByText(KEY_LOCATION)).toBeVisible();
  await page.clock.runFor(61_000);
  await expect(card.getByText(CODE)).toHaveCount(0);

  // The job done: the codes leave the phone.
  await card.getByRole("button", { name: "Klart" }).click();
  await expect.poll(() => storedCodes(page, visitId)).toBeNull();

  // The download to the phone is in the log, like any view of the code.
  const { db, close } = connect();
  try {
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.userId, veraId), eq(auditLog.subjectId, visitId)));
    expect(rows.map((r) => r.action)).toContain("access_code_viewed");
  } finally {
    await close();
  }
});
