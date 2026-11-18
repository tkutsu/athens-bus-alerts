import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const SYNTAGMA = { latitude: 37.975096, longitude: 23.735739 };
const METERS_PER_DEGREE = 111_195;

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

async function openNearby(context: BrowserContext, page: Page, at = north(0)) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(at);
  await mockCatalogue(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByPlaceholder("Search stop name").click();
}

test("chips mark the stop at a station, and the switch removes the whole layer", async ({
  context,
  page,
}) => {
  await openNearby(context, page);

  const syntagma = page.getByRole("option", { name: /συνταγμα/ });
  await expect(syntagma).toContainText("near metro lines 2 and 3 and tram line 6");
  await expect(page.getByRole("option", { name: /μακρια/ }).locator(".metro-chip")).toHaveCount(0);
  await expect(page.getByText("Closest metro:")).toBeAttached();

  await page.getByRole("switch", { name: "Show metro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-metro", "off");
  await expect(syntagma.locator(".metro-chips")).toBeHidden();
  await expect(page.locator(".closest-metro")).toBeHidden();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-metro", "off");
  await expect(page.getByRole("switch", { name: "Show metro" })).not.toBeChecked();
});

test("a bus tag shows the metro lines the bus reaches after your stop", async ({
  context,
  page,
}) => {
  const KOLONAKI = { code: "30000", name: "ΚΟΛΩΝΑΚΙ", ...north(-1_500) };
  await page.route("**/data/stops.json", (route) =>
    route.fulfill({
      json: {
        generatedAt: "2026-11-18T00:00:00.000Z",
        source: "test",
        stops: [KOLONAKI],
        stations: [{ name: "ΣΥΝΤΑΓΜΑ", lines: ["M2", "M3"], ...SYNTAGMA }],
      },
    }),
  );
  await page.route("**/api/stops/30000", (route) =>
    route.fulfill({
      json: { routes: [{ routeCode: "2810", lineId: "060", description: "ΚΟΛΩΝΑΚΙ - ΣΥΝΤΑΓΜΑ", destination: "ΣΥΝΤΑΓΜΑ" }] },
    }),
  );
  await page.route("**/api/stops/30000/arrivals", (route) =>
    route.fulfill({
      json: {
        arrivals: [{ routeCode: "2810", vehicleId: "a", minutes: 5 }],
        observedAt: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/routes/2810", (route) =>
    route.fulfill({
      json: {
        routeCode: "2810",
        origin: "ΚΟΛΩΝΑΚΙ",
        destination: "ΣΥΝΤΑΓΜΑ",
        isCircular: false,
        stops: [
          { ...KOLONAKI, street: null, order: 1 },
          { code: "10361", name: "ΣΥΝΤΑΓΜΑ", street: null, order: 2, ...north(60) },
        ],
      },
    }),
  );
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(north(-1_500));
  await page.goto("/");
  await page.getByPlaceholder("Search stop name").click();
  await page.getByRole("option", { name: /κολωνακι/ }).click();

  const tag = page.locator(".arrival-bus");
  await expect(tag).toHaveAttribute("aria-label", /reaches metro lines 2 and 3$/);
  await expect(tag.locator(".metro-chip")).toHaveText(["2", "3"]);
});

test("the closest metro shows a calm distance and a heads-up once on approach", async ({
  context,
  page,
}) => {
  await openNearby(context, page, north(-800));
  const readout = page.locator(".closest-metro-line");
  await expect(readout).toContainText(/συνταγμα\s*· 800 meters/);

  // Riding north toward the station: the heads-up comes once, ~600 m out.
  for (const meters of [-590, -560, -530]) {
    await context.setGeolocation(north(meters));
    await expect(readout).toContainText(`${-meters} meters`);
  }
  await expect(page.getByText(/Metro coming up: συνταγμα, about 550 meters ahead\. Lines 2 and 3\./)).toBeVisible();

  await page.getByRole("button", { name: "Dismiss message" }).click();
  for (const meters of [-400, -200, -50]) {
    await context.setGeolocation(north(meters));
  }
  await expect(readout).toContainText("· here");
  await expect(page.getByText(/Metro coming up/)).toHaveCount(0);
});
