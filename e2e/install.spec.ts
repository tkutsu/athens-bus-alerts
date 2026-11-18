import { expect, test } from "@playwright/test";

const firefoxAndroid =
  "Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0";

test("shows install steps where the browser has no install prompt", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    userAgent: firefoxAndroid,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Install" }).click();
  await expect(page.getByRole("heading", { name: "Install the app" })).toBeVisible();
  await expect(page.getByText("Add app to Home screen")).toBeVisible();
  await page.getByRole("button", { name: "Close install steps" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await context.close();
});

test("uses the native install prompt and hides once installed", async ({ page }) => {
  await page.goto("/");
  // The link renders after hydration, so the listener is in place.
  await expect(page.getByRole("button", { name: "Install" })).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        (window as unknown as { prompted: boolean }).prompted = true;
        return Promise.resolve();
      },
    });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Install" }).click();
  expect(
    await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted),
  ).toBe(true);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(page.getByRole("button", { name: "Install" })).toBeHidden();
});

test("hides the install link inside the installed app", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({ ...matchMedia(query), matches: true } as MediaQueryList)
        : matchMedia(query);
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Favorites" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install" })).toHaveCount(0);
  await context.close();
});
