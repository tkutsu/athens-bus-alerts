import { expect, test, type Page, type Route } from "@playwright/test";

const STOPS = [
  {
    code: "400075",
    name: "FIRST STOP",
    latitude: 37.9445913,
    longitude: 23.6671421,
  },
  {
    code: "400076",
    name: "SECOND STOP",
    latitude: 37.945,
    longitude: 23.668,
  },
];

async function mockCatalogue(page: Page) {
  await page.route("**/data/stops.json", (route) =>
    route.fulfill({
      json: {
        generatedAt: "2026-08-07T10:00:00.000Z",
        source: "test",
        stops: STOPS,
      },
    }),
  );
}

function routePayload(routeCode: string, lineId: string) {
  return {
    routes: [{ routeCode, lineId, description: `Line ${lineId}` }],
  };
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: STOPS[0].latitude,
    longitude: STOPS[0].longitude,
  });
});

test("keeps only the latest stop load and reuses its routes and map", async ({
  page,
}) => {
  await mockCatalogue(page);
  let releaseFirst: (() => void) | undefined;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const metadataRequests = new Map<string, number>();

  const fulfillMetadata = async (route: Route, code: string) => {
    metadataRequests.set(code, (metadataRequests.get(code) ?? 0) + 1);
    if (code === "400075") await firstCanFinish;
    await route
      .fulfill({
        json:
          code === "400075"
            ? routePayload("2810", "218")
            : routePayload("5000", "500"),
      })
      .catch(() => undefined);
  };

  await page.route("**/api/stops/400075", (route) =>
    fulfillMetadata(route, "400075"),
  );
  await page.route("**/api/stops/400076", (route) =>
    fulfillMetadata(route, "400076"),
  );
  await page.route("**/api/stops/*/arrivals", (route) =>
    route.fulfill({
      json: { arrivals: [], observedAt: new Date().toISOString() },
    }),
  );

  await page.goto("/");
  const map = page.getByLabel("Map of OASA bus stops");
  await expect(map).toBeVisible();
  await map.evaluate((element) => {
    element.dataset.instance = "retained";
  });

  const picker = page.getByRole("combobox", {
    name: "Search and choose a stop",
  });
  await picker.click();
  await page.getByRole("option", { name: /first stop/i }).click();
  await expect.poll(() => metadataRequests.get("400075") ?? 0).toBe(1);

  await picker.click();
  await page.getByRole("option", { name: /first stop/i }).click();
  expect(metadataRequests.get("400075")).toBe(1);

  await picker.click();
  await page.getByRole("option", { name: /second stop/i }).click();
  await expect(page.getByText("second stop", { exact: true })).toBeVisible();
  releaseFirst?.();
  await expect(page.getByText("second stop", { exact: true })).toBeVisible();
  await expect(map).toHaveAttribute("data-instance", "retained");
  expect(metadataRequests.get("400076")).toBe(1);

  await page.getByRole("button", { name: /second stop.*change/i }).click();
  await picker.click();
  await page.getByRole("option", { name: /second stop/i }).click();
  await expect(page.getByLabel("Bus arrivals")).toBeVisible();
  expect(metadataRequests.get("400076")).toBe(1);
});

test("forgetting data cancels an unfinished stop load", async ({ page }) => {
  await mockCatalogue(page);
  let releaseMetadata: (() => void) | undefined;
  const metadataCanFinish = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  let arrivalRequests = 0;

  await page.route("**/api/stops/400075", async (route) => {
    await metadataCanFinish;
    await route
      .fulfill({ json: routePayload("2810", "218") })
      .catch(() => undefined);
  });
  await page.route("**/api/stops/400075/arrivals", (route) => {
    arrivalRequests += 1;
    return route.fulfill({
      json: { arrivals: [], observedAt: new Date().toISOString() },
    });
  });

  await page.goto("/");
  const picker = page.getByRole("combobox", {
    name: "Search and choose a stop",
  });
  await picker.click();
  await page.getByRole("option", { name: /first stop/i }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Forget saved data" }).click();
  releaseMetadata?.();

  await expect(page.getByLabel("Map of OASA bus stops")).toBeVisible();
  await expect(page.getByText("first stop", { exact: true })).toHaveCount(0);
  expect(arrivalRequests).toBe(0);
});

test("requests location once until the user explicitly refreshes it", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(({ latitude, longitude }) => {
    Object.defineProperty(window, "__locationCalls", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          window.__locationCalls += 1;
          success({
            coords: {
              accuracy: 1,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              latitude,
              longitude,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  }, {
    latitude: STOPS[0].latitude,
    longitude: STOPS[0].longitude,
  });
  await mockCatalogue(page);

  await page.goto("/");
  await page.clock.fastForward(60_000);
  await expect.poll(() => page.evaluate(() => window.__locationCalls)).toBe(1);

  await page
    .getByRole("button", { name: "Refresh and center on your location" })
    .click();
  await expect.poll(() => page.evaluate(() => window.__locationCalls)).toBe(2);
});

declare global {
  interface Window {
    __locationCalls: number;
  }
}
