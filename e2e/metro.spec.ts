import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const SYNTAGMA = { latitude: 37.975096, longitude: 23.735739 };
const METERS_PER_DEGREE = 111_195;

/** Measures badge text against its background composited over the page. */
async function badgeContrast(badge: Locator) {
  return badge.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const style = getComputedStyle(element);
    const luminance = () => {
      const channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
        .map((value) => value / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const background = luminance();
    context.fillStyle = style.color;
    context.fillRect(0, 0, 1, 1);
    const foreground = luminance();
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

/** A point `meters` north of Syntagma station (negative is south). */
function north(meters: number) {
  return {
    latitude: SYNTAGMA.latitude + meters / METERS_PER_DEGREE,
    longitude: SYNTAGMA.longitude,
    accuracy: 10,
  };
}

async function mockCatalogue(page: Page) {
  await page.route("**/data/stops.json", (route) =>
    route.fulfill({
      json: {
        generatedAt: "2026-11-18T00:00:00.000Z",
        source: "test",
        stops: [
          { code: "10361", name: "ΣΥΝΤΑΓΜΑ", ...north(60) },
          { code: "20000", name: "ΜΑΚΡΙΑ", ...north(2_000) },
        ],
        stations: [
          { name: "ΣΥΝΤΑΓΜΑ", lines: ["M2", "M3"], ...SYNTAGMA },
          // 180 m from the bus stop: inside the chip radius, but tram only.
          { name: "Ζάππειο", lines: ["T6"], ...north(-120) },
        ],
      },
    }),
  );
}

async function openApp(context: BrowserContext, page: Page, at = north(0)) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(at);
  await mockCatalogue(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
}

async function openNearby(context: BrowserContext, page: Page, at = north(0)) {
  await openApp(context, page, at);
  await page.getByPlaceholder("Search stop name").click();
}

test("lines start off, only one can be selected, and the choice persists", async ({
  context,
  page,
}) => {
  await openNearby(context, page);

  const syntagma = page.getByRole("option", { name: /συνταγμα/ });
  await expect(syntagma.locator(".rail-badge")).toHaveCount(0);
  await expect(page.getByRole("option", { name: /μακρια/ }).locator(".rail-badge")).toHaveCount(0);

  const lines = page.getByRole("group", { name: "Metro and tram lines" });
  await expect(lines.locator('[aria-pressed="true"]')).toHaveCount(0);
  await lines.getByRole("button", { name: "metro line 2" }).click();
  await page.getByPlaceholder("Search stop name").click();
  await expect(syntagma.locator(".rail-badge")).toHaveText(["M2"]);
  await lines.getByRole("button", { name: "metro line 3" }).click();
  await expect(lines.getByRole("button", { name: "metro line 2" })).toHaveAttribute("aria-pressed", "false");
  await page.getByPlaceholder("Search stop name").click();
  await expect(syntagma.locator(".rail-badge")).toHaveText(["M3"]);
  await lines.getByRole("button", { name: "tram line 6" }).click();
  await expect(lines.locator('[aria-pressed="true"]')).toHaveCount(1);
  await page.getByPlaceholder("Search stop name").click();
  await expect(syntagma.locator(".rail-badge")).toHaveText(["T6"]);
  await expect(page.locator(".closest-metro")).toHaveAttribute("data-visible", "false");

  await page.reload();
  await expect(lines.getByRole("button", { name: "tram line 6" })).toHaveAttribute("aria-pressed", "true");
  await expect(lines.locator('[aria-pressed="true"]')).toHaveCount(1);
  await lines.getByRole("button", { name: "tram line 6" }).click();
  await expect(lines.locator('[aria-pressed="true"]')).toHaveCount(0);
});

test("tapping a line on the map shows or hides it", async ({ context, page }) => {
  await openApp(context, page, north(-150));
  const lines = page.getByRole("group", { name: "Metro and tram lines" });
  const mapBadge = page.locator('.map-station [data-line="M2"]');

  await mapBadge.click();
  await expect(lines.getByRole("button", { name: "metro line 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(mapBadge).not.toHaveClass(/rail-badge-off/);

  await lines.getByRole("button", { name: "metro line 3" }).click();
  await expect(mapBadge).toHaveClass(/rail-badge-off/);

  await mapBadge.click();
  await expect(lines.getByRole("button", { name: "metro line 2" })).toHaveAttribute("aria-pressed", "true");
  await expect(lines.getByRole("button", { name: "metro line 3" })).toHaveAttribute("aria-pressed", "false");
  await mapBadge.click();
  await expect(lines.locator('[aria-pressed="true"]')).toHaveCount(0);
});

test("both tram lines use yellow in light and dark themes", async ({ context, page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(context, page);
  const lines = page.getByRole("group", { name: "Metro and tram lines" });
  for (const line of [6, 7]) {
    const badge = lines.getByRole("button", { name: `tram line ${line}` });
    await badge.click();
    await expect(badge).toHaveCSS("background-color", "rgb(255, 218, 31)");
    await expect(badge).toHaveCSS("color", "rgb(48, 38, 0)");
    await page.getByRole("switch", { name: "Use dark mode" }).click();
    await expect(badge).toHaveCSS("background-color", "rgb(255, 218, 31)");
    await expect(badge).toHaveCSS("color", "rgb(48, 38, 0)");
    await page.getByRole("switch", { name: "Use light mode" }).click();
  }
});

test("the closest metro shows a calm distance and a heads-up once on approach", async ({
  context,
  page,
}) => {
  await openNearby(context, page, north(-800));
  await page.getByRole("button", { name: "metro line 3", exact: true }).click();
  const readout = page.locator(".closest-metro-line");
  await expect(readout).toContainText(/συνταγμα\s*· 800 meters/);

  // Riding north toward the station: the heads-up comes once, ~600 m out.
  for (const meters of [-590, -560, -530]) {
    await context.setGeolocation(north(meters));
    await expect(readout).toContainText(`${-meters} meters`);
  }
  await expect(page.getByText(/Metro coming up: συνταγμα, about 550 meters ahead\. Lines M2 and M3\./)).toBeVisible();

  await page.getByRole("button", { name: "Dismiss message" }).click();
  for (const meters of [-400, -200, -50]) {
    await context.setGeolocation(north(meters));
  }
  await expect(readout).toContainText("· here");
  await expect(page.getByText(/Metro coming up/)).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`bus badges count stops to the selected line at ${width}px`, async ({ context, page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "Notification", { configurable: true, value: class {
        static permission = "granted";
      } });
    });
    const boarding = { code: "30000", name: "ΑΡΧΗ", ...north(-1500) };
    const stops = [-1500, -1200, -900, -350, 0].map((meters, index) => ({
      code: String(30000 + index), name: "Stop", street: null,
      order: index + 1, ...north(meters),
    }));
    await page.route("**/data/stops.json", (route) => route.fulfill({ json: {
      stops: [boarding], stations: [
        { name: "ΣΥΝΤΑΓΜΑ", lines: ["M3"], ...SYNTAGMA },
        { name: "Tram", lines: ["T6"], ...north(-350) },
      ],
    } }));
    await page.route("**/api/stops/30000", (route) => route.fulfill({ json: {
      routes: [
        { routeCode: "2810", lineId: "060", description: "ΑΡΧΗ - ΣΥΝΤΑΓΜΑ", destination: "ΣΥΝΤΑΓΜΑ" },
        { routeCode: "2811", lineId: "061", description: "ΑΡΧΗ - ΑΛΛΟΥ", destination: "ΑΛΛΟΥ" },
        { routeCode: "2812", lineId: "060", description: "ΑΡΧΗ - ΣΥΝΤΑΓΜΑ", destination: "ΣΥΝΤΑΓΜΑ" },
      ],
    } }));
    await page.route("**/api/stops/30000/arrivals", (route) => route.fulfill({ json: {
      arrivals: [
        { routeCode: "2810", vehicleId: "a", minutes: 5 },
        { routeCode: "2810", vehicleId: "b", minutes: 10 },
        { routeCode: "2812", vehicleId: "d", minutes: 12 },
        { routeCode: "2811", vehicleId: "c", minutes: 15 },
      ], observedAt: new Date().toISOString(),
    } }));
    let detailRequests = 0;
    await page.route("**/api/routes/*", (route) => {
      detailRequests++;
      const routeCode = route.request().url().split("/").at(-1);
      return route.fulfill({ json: {
        routeCode, origin: "Start", destination: "End", isCircular: false,
        stops,
      } });
    });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(north(-1500));
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const lines = page.getByRole("group", { name: "Metro and tram lines" });
    await lines.getByRole("button", { name: "metro line 3" }).click();
    await page.getByPlaceholder("Search stop name").click();
    await page.getByRole("option", { name: /αρχη/ }).click();
    const badges = page.locator(".arrival-tag > .rail-badge");
    await expect(badges).toHaveText(["M3: 4 stops", "M3: 4 stops"]);
    await expect(page.getByRole("button", { name: /notifications for line 060.*M3: 4 stops/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /notifications for line 060, 5 minutes away, M3: 4 stops/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /notifications for line 061.*M3: 4 stops/ })).toHaveCount(1);
    await page.getByRole("button", { name: /Enable notifications for line 060, 5 minutes away/ }).click();
    const selectedBadge = page.locator(".arrival-bus-selected + .rail-badge").first();
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await page.getByRole("switch", { name: "Use dark mode" }).click();
      await expect.poll(() => badgeContrast(selectedBadge)).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByRole("switch", { name: "Use light mode" }).click();
    for (const direction of await page.locator(".arrival-bus-direction").all()) {
      await expect.poll(() => direction.evaluate((element) =>
        element.scrollWidth - element.clientWidth,
      )).toBeLessThanOrEqual(1);
    }
    expect(detailRequests).toBe(3);
    for (const badge of await badges.all()) {
      const box = await badge.boundingBox();
      const busBox = await badge.locator("..").locator(".arrival-bus").boundingBox();
      expect(box!.x).toBeGreaterThan(busBox!.x + busBox!.width);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }

    await page.locator(".selected-stop-row").click();
    await lines.getByRole("button", { name: "tram line 6" }).click();
    await page.locator(".selected-stop-row").click();
    await expect(badges).toHaveText(["T6: 3 stops", "T6: 3 stops"]);
    await expect(selectedBadge).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      if (theme === "dark") await page.getByRole("switch", { name: "Use dark mode" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect.poll(() => badgeContrast(selectedBadge)).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({ path: `/tmp/oasa-metro-${width}-dark.png`, animations: "disabled" });
    await page.getByRole("switch", { name: "Use light mode" }).click();
    await expect(badges.first()).toBeVisible();
    await page.screenshot({ path: `/tmp/oasa-metro-${width}.png`, animations: "disabled" });
    await page.locator(".selected-stop-row").click();
    await page.getByRole("button", { name: "tram line 6" }).click();
    await expect(badges).toHaveCount(0);
    expect(detailRequests).toBe(3);
  });
}
