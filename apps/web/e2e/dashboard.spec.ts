import { appUser, connect, refreshKpiViews, task } from "@bojen/db";
import { DEMO_TENANT_ID } from "@bojen/db/seed";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { signInOwner } from "./staff-login";

/** An owner of their own, independent of the other tests. */
const DAG = "dag@jonas-batservice.test";
const TODO = "Ring Anna L – obekräftad i morgon";
const tenantId = DEMO_TENANT_ID;
let taskId = "";

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
  const order = ["Idag", "Intäkt", "förbokad", "Kunder", "Att göra"].map((name) =>
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
});
