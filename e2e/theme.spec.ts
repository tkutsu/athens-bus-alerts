import { expect, test } from "@playwright/test";

test("defaults to the system theme and persists an explicit choice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(17, 23, 19)",
  );

  const themeSwitch = page.getByRole("switch", { name: "Use light mode" });
  await expect(themeSwitch).toBeChecked();
  await expect(page.locator("header").getByRole("switch")).toHaveCount(0);
  await expect(page.locator("footer").getByRole("switch")).toHaveCount(1);
  const centerOffset = await themeSwitch.evaluate((element) => {
    const switchBounds = element.getBoundingClientRect();
    const footerBounds = element.closest("footer")!.getBoundingClientRect();
    return Math.abs(
      switchBounds.left + switchBounds.width / 2 -
        (footerBounds.left + footerBounds.width / 2),
    );
  });
  expect(centerOffset).toBeLessThan(1);
  await themeSwitch.click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("switch", { name: "Use dark mode" }),
  ).not.toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("oasa-theme")))
    .toBe("light");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("switch", { name: "Use dark mode" }),
  ).not.toBeChecked();
});
