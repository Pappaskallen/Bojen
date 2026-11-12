import { expect, test } from "@playwright/test";

test("the widget shows the booking page inside a static page and grows with it", async ({
  page,
  baseURL,
}) => {
  await page.setContent(`<!doctype html>
    <html lang="sv"><body>
      <h1>Jonas Båtservice – vår egen sida</h1>
      <bojen-boka firma="jonas-batservice" marina="bullando-marina"></bojen-boka>
      <script src="${baseURL ?? ""}/widget.js"></script>
    </body></html>`);
  const frame = page.frameLocator("bojen-boka iframe");
  await expect(frame.getByText("Steg 1 av 6")).toBeVisible();
  await frame.getByRole("radio", { name: /Vinterkonservering/ }).check();
  await frame.getByRole("button", { name: "Nästa" }).click();
  await expect(frame.getByText("Steg 2 av 6")).toBeVisible();
  // Inside the widget the page has no header of its own.
  await expect(frame.getByRole("heading", { name: /Boka hos/ })).toHaveCount(0);
  await expect
    .poll(async () =>
      Number.parseInt(
        await page
          .locator("bojen-boka iframe")
          .evaluate((el) => (el as HTMLIFrameElement).style.height),
        10,
      ),
    )
    .toBeGreaterThan(320);
});
