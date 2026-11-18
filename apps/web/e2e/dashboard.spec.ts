import { appUser, call, connect, refreshKpiViews, task } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { signInOwner } from "./staff-login";

/** An owner of their own, independent of the other tests. */
const DAG = "dag@jonas-batservice.test";
const TODO = "Ring Anna L – obekräftad i morgon";
const tenantId = DEMO_TENANT_ID;
let taskId = "";
const CALL_NOTE = "- E2E: kopplad till mekanikern om impellern";
let callIds: string[] = [];

// The sketch in spec 9.2 is drawn for a phone 360 px wide.
test.use({ viewport: { width: 360, height: 800 } });

test.beforeAll(async () => {
  const { db, close } = connect();
  try {
    await db.insert(appUser).values({ tenantId, name: "Dag Ägare", role: "owner", email: DAG });
    // High and oldest, so it is among the three the card lists.
    const [made] = await db
      .insert(task)
      .values({
        tenantId,
        type: "call_back",
        title: TODO,
        priority: "high",
        createdAt: new Date("2020-01-01T08:00:00Z"),
      })
      .returning({ id: task.id });
    taskId = made?.id ?? "";
    // Two calls an hour ago, for the receptionist's card and list (step 7.3).
    const hourAgo = new Date(Date.now() - 3_600_000);
    const calls = await db
      .insert(call)
      .values([
        {
          tenantId,
          startedAt: hourAgo,
          outcome: "transferred",
          intent: "emergency",
          summary: CALL_NOTE,
        },
        {
          tenantId,
          startedAt: hourAgo,
          outcome: "spam",
          intent: "other",
          summary: "- E2E: säljare",
        },
      ])
      .returning({ id: call.id });
    callIds = calls.map((c) => c.id);
    // No worker runs here: the views are brought up to date as it would every 15 minutes.
    await refreshKpiViews(db);
  } finally {
    await close();
  }
});

test.afterAll(async () => {
  const { db, close } = connect();
  try {
    await db.delete(task).where(eq(task.id, taskId));
    await db.delete(call).where(inArray(call.id, callIds));
  } finally {
    await close();
  }
});

test("the owner's dashboard follows the sketch at 360 px, and its cards open (step 7.2)", async ({
  page,
}, testInfo) => {
  await signInOwner(page, DAG, "/oversikt");
  await expect(page.getByRole("heading", { level: 1, name: "Översikt" })).toBeVisible();

  // Top to bottom as in spec 9.2.
  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  const order = ["Idag", "Intäkt", "förbokad", "Receptionisten", "Kunder", "Att göra"].map((name) =>
    headings.findIndex((h) => h.includes(name)),
  );
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  await expect(page.getByRole("link", { name: "Öppna dagens rutt →" })).toBeVisible();

  // The four KPIs two by two, each a card to tap.
  const tiles = page.locator(".dash-tiles .kpi-card");
  await expect(tiles).toHaveCount(4);
  const boxes = await Promise.all(
    [0, 1, 2, 3].map(async (i) => (await tiles.nth(i).boundingBox()) ?? { x: 0, y: 0 }),
  );
  expect(boxes[0]?.y).toBe(boxes[1]?.y);
  expect(boxes[2]?.y).toBe(boxes[3]?.y);
  expect(boxes[0]?.x).toBe(boxes[2]?.x);
  for (const name of ["Beläggning", "Körandel", "Jobb/marina", "Ej tillgänglig"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  // A colour is the target's verdict, never a bare dot.
  for (const dot of await page.locator(".level").all()) {
    expect(["målet nått", "nära målet", "långt från målet"]).toContain(
      await dot.getAttribute("title"),
    );
  }

  // Att göra shows the open matters, at most three.
  const todo = page.getByRole("list", { name: /^⚠ Att göra/ });
  await expect(todo.getByText(TODO)).toBeVisible();
  expect(await todo.getByRole("listitem").count()).toBeLessThanOrEqual(3);

  // Nothing wider than the phone.
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);

  const shot = testInfo.outputPath("oversikt-360.png");
  await page.screenshot({ path: shot, fullPage: true });
  await testInfo.attach("översikten i mobilen", { path: shot, contentType: "image/png" });

  // A card opens its details: the trend per week and the breakdowns.
  await page.getByRole("link", { name: /^Beläggning/ }).click();
  await expect(page).toHaveURL(/\/oversikt\/belaggning\?manad=\d{4}-\d{2}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Beläggning" })).toBeVisible();
  await expect(page.getByText("Mål: 85 %–95 %")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Per vecka" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Per mekaniker/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Per tjänst/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.getByRole("link", { name: "← Översikt" }).click();
  await expect(page).toHaveURL(/\/oversikt\?manad=/);

  // The receptionist's card opens KPI 21–24 and the calls, filtered on outcome (step 7.3).
  await page.getByRole("link", { name: /^Receptionisten \(30 dagar\)/ }).click();
  await expect(page).toHaveURL(/\/oversikt\/samtal$/);
  for (const name of [
    "Antal samtal",
    "Konvertering till bokning",
    "Kopplade vidare",
    "Utanför kontorstid",
  ]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  const list = page.getByRole("list", { name: "Samtal" });
  await expect(list.getByText(CALL_NOTE)).toBeVisible();
  const filters = page.getByRole("navigation", { name: "Utfall" });
  await filters.getByRole("link", { name: "Kopplade" }).click();
  await expect(page).toHaveURL(/utfall=transferred$/);
  await expect(filters.getByText("Kopplade")).toHaveAttribute("aria-current", "page");
  await expect(list.getByText(CALL_NOTE)).toBeVisible();
  for (const item of await list.getByRole("listitem").all()) {
    await expect(item.getByText(/^Kopplad/)).toBeVisible();
  }
  await filters.getByRole("link", { name: "Spam" }).click();
  await expect(list.getByText("- E2E: säljare")).toBeVisible();
  await expect(list.getByText(CALL_NOTE)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
