import { expect, test, type Page } from "@playwright/test";

/**
 * The security headers (ASVS V14.4, Avslutande kontroll): on every page, with the booking pages
 * frameable for the widget, and no page breaking its own Content Security Policy.
 */
test("every page sends the security headers; only the booking pages may be framed", async ({
  request,
}) => {
  for (const path of ["/", "/logga-in", "/r/AAAAAAAA"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], path).toContain("object-src 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["strict-transport-security"], path).toContain("max-age=");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }

  const booking = (await request.get("/boka/jonas-batservice")).headers();
  expect(booking["content-security-policy"]).toContain("default-src 'self'");
  expect(booking["content-security-policy"]).not.toContain("frame-ancestors");
  expect(booking["x-frame-options"]).toBeUndefined();
  expect(booking["x-content-type-options"]).toBe("nosniff");
});

/** The policy violations a page reports while it loads. */
function violations(page: Page): string[] {
  const found: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) found.push(message.text());
  });
  return found;
}

test("the public pages run within their Content Security Policy", async ({ page }) => {
  const found = violations(page);
  await page.goto("/boka/jonas-batservice/m/bullando-marina");
  await page.getByRole("radio", { name: /Vinterkonservering/ }).check();
  await page.getByRole("button", { name: "Nästa" }).click();
  await expect(page.getByText("Steg 2 av 6")).toBeVisible();
  await page.goto("/logga-in");
  await expect(page.getByRole("button").first()).toBeVisible();
  expect(found).toEqual([]);
});
