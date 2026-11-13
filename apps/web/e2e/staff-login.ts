import { expect, type Page } from "@playwright/test";

/** Mailpit, where local Supabase Auth delivers its e-mail. */
export const MAILPIT = "http://127.0.0.1:54324";

export interface MailpitList {
  messages?: { ID: string; Created: string }[];
}

/** The newest six-digit code sent to `email` after `since`. */
export async function codeFromMail(page: Page, email: string, since: Date): Promise<string> {
  let found: string | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:${email}`);
        const list = (await (
          await page.request.get(`${MAILPIT}/api/v1/search?query=${query}`)
        ).json()) as MailpitList;
        const newest = (list.messages ?? []).find((m) => new Date(m.Created) >= since);
        if (!newest) return false;
        const message = (await (
          await page.request.get(`${MAILPIT}/api/v1/message/${newest.ID}`)
        ).json()) as { Text?: string; HTML?: string };
        found = /\b(\d{6})\b/.exec(`${message.Text ?? ""} ${message.HTML ?? ""}`)?.[1];
        return Boolean(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found ?? "";
}

/** The first step: the code by e-mail. */
export async function emailCode(page: Page, email: string, path = "/forfragningar") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/logga-in\?nasta=/);
  const since = new Date(Date.now() - 2000);
  await page.getByLabel("E-postadress").fill(email);
  await page.getByRole("button", { name: "Skicka kod" }).click();
  await expect(page.getByText(/Om adressen finns hos oss/)).toBeVisible();
  await page.getByLabel("Kod från e-post").fill(await codeFromMail(page, email, since));
  await page.getByRole("button", { name: "Logga in" }).click();
}
