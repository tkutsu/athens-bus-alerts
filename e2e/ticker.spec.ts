import { expect, test, type Page } from "@playwright/test";

async function mockStopData(page: Page) {
  await page.route("**/data/stops.json", async (route) => {
    await route.fulfill({
      json: {
        generatedAt: "2026-07-29T09:56:48.228Z",
        source: "test",
        stops: [
          {
            code: "400075",
            name: "HSAP N. FALHROY",
            latitude: 37.9445913,
            longitude: 23.6671421,
          },
        ],
      },
    });
  });
  await page.route("**/api/stops/400075", async (route) => {
    await route.fulfill({
      json: {
        stop: {
          code: "400075",
          name: "HSAP N. FALHROY",
          street: null,
          latitude: 37.9445913,
          longitude: 23.6671421,
          distanceMeters: 0,
        },
        routes: [
          {
            routeCode: "2810",
            lineId: "218",
            description: "PEIRAIAS - ST. DAFNIS",
          },
          {
            routeCode: "5000",
            lineId: "500",
            description: "PEIRAIAS - KIFISIA",
          },
        ],
        lines: [
          {
            lineId: "218",
            description: "PEIRAIAS - ST. DAFNIS",
          },
          {
            lineId: "500",
            description: "PEIRAIAS - KIFISIA",
          },
        ],
      },
    });
  });
  await page.route("**/api/stops/400075/arrivals", async (route) => {
    await route.fulfill({
      json: {
        arrivals: [
          { routeCode: "2810", vehicleId: "218-a", minutes: 4 },
          { routeCode: "5000", vehicleId: "500-a", minutes: 6 },
        ],
        observedAt: new Date().toISOString(),
      },
    });
  });
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 37.9445913,
    longitude: 23.6671421,
  });
});

test("uses the subtitle as gated tabs and saves per-bus alert times", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "granted";
        static requestPermission = async () => "granted";
      },
    });
  });
  await mockStopData(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Athens Bus Notifications" }),
  ).toBeVisible();
  await expect(
    page.getByText("Pick stop · Pick bus · Get notified"),
  ).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCSS(
    "border-bottom-width",
    "0px",
  );
  await expect(page.locator("footer")).toHaveCSS(
    "border-top-width",
    "0px",
  );

  const stopTab = page.getByRole("tab", { name: "Pick Stop" });
  const busTab = page.getByRole("tab", { name: "Pick Bus" });
  const notifyButton = page.getByRole("button", {
    name: "Notify",
    exact: true,
  });
  const favoritesButton = page
    .locator("header")
    .getByRole("button", {
      name: "Favorites",
      exact: true,
    });
  await expect(favoritesButton).toContainText("Favorites");
  await expect(favoritesButton).toHaveCSS("align-items", "center");
  await expect(favoritesButton.locator("svg")).toHaveCSS(
    "width",
    "16px",
  );
  await expect(favoritesButton.locator("svg")).toHaveCSS(
    "height",
    "16px",
  );
  await expect(favoritesButton.locator("svg")).toHaveCSS(
    "translate",
    "0px -1px",
  );
  await expect(stopTab).toHaveAttribute("aria-selected", "true");
  await expect(busTab).toBeDisabled();
  await expect(notifyButton).toBeDisabled();
  await expect(stopTab).not.toHaveCSS(
    "background-color",
    "rgb(23, 32, 27)",
  );
  await expect(notifyButton.locator("svg")).toHaveCSS(
    "animation-name",
    "none",
  );
  const disabledBusBorder = await busTab.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await busTab.hover({ force: true });
  await expect(busTab).toHaveCSS("border-color", disabledBusBorder);
  await expect(page.getByLabel("Map of OASA bus stops")).toBeVisible();

  const stopPicker = page.getByRole("combobox", {
    name: "Search and choose a stop",
  });
  await stopPicker.click();
  await page
    .getByRole("option", { name: /1\. hsap n\. falhroy/ })
    .click();

  const selectedStopTab = page.getByRole("tab", {
    name: "hsap n. falhroy",
    exact: true,
  });
  await expect(selectedStopTab).toBeVisible();
  await expect(page.getByRole("tab", { name: /Pick Stop/ })).toHaveCount(0);
  await expect(busTab).toBeEnabled();
  await expect(notifyButton.locator("svg")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(page.getByLabel("Map of OASA bus stops")).toBeVisible();

  await busTab.hover();
  await expect(busTab).toHaveCSS("border-color", "rgb(23, 32, 27)");
  await busTab.click();
  await expect(page.getByLabel("Map of OASA bus stops")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "218: 10 min" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "500: 10 min" }),
  ).toHaveCount(0);
  const bus218Button = page.getByRole("button", { name: /^218 / });
  await bus218Button.click();
  const bus218Ten = page.getByRole("button", {
    name: "218: 10 min",
  });
  const bus218Three = page.getByRole("button", {
    name: "218: 3 min",
  });
  const bus218One = page.getByRole("button", {
    name: "218: 1 min",
  });
  await expect(bus218Ten).toBeVisible();
  expect(
    await bus218Ten.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderRadius),
    ),
  ).toBeGreaterThan(13);
  await expect(bus218Ten).toHaveCSS("font-size", "12px");
  await expect(bus218Ten).toHaveCSS("min-height", "28px");
  const busBadgeBox = await bus218Button
    .locator(".arrival-line-selected")
    .boundingBox();
  const busDescriptionBox = await bus218Button
    .getByText("peiraias - st. dafnis", { exact: true })
    .boundingBox();
  expect(busBadgeBox).not.toBeNull();
  expect(busDescriptionBox).not.toBeNull();
  expect(busDescriptionBox!.y).toBeGreaterThan(
    busBadgeBox!.y + busBadgeBox!.height,
  );
  await expect(notifyButton.locator("svg")).toHaveCSS(
    "animation-name",
    "notify-bell-ring",
  );
  await bus218Three.click();
  await bus218One.click();
  await expect(notifyButton.locator("svg")).toHaveCSS(
    "animation-name",
    "none",
  );
  await bus218Three.click();
  await bus218One.click();
  await expect(
    page.getByRole("button", { name: "500: 10 min" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^500 / }).click();
  const bus500Ten = page.getByRole("button", {
    name: "500: 10 min",
  });
  const bus500Three = page.getByRole("button", {
    name: "500: 3 min",
  });
  const bus500One = page.getByRole("button", {
    name: "500: 1 min",
  });
  const selectedBusTab = page.getByRole("tab", {
    name: "218 500",
    exact: true,
  });
  await expect(selectedBusTab).toHaveAttribute("aria-selected", "true");
  await expect(notifyButton).toBeEnabled();
  await expect(notifyButton.locator("svg")).toHaveCSS(
    "animation-name",
    "notify-bell-ring",
  );
  await expect(bus218Ten).toHaveAttribute("aria-pressed", "false");
  await expect(bus500Ten).toHaveAttribute("aria-pressed", "false");
  await expect(bus218Three).toHaveAttribute("aria-pressed", "true");
  await expect(bus218One).toHaveAttribute("aria-pressed", "true");
  await expect(bus500Three).toHaveAttribute("aria-pressed", "true");
  await expect(bus500One).toHaveAttribute("aria-pressed", "true");
  await bus218Ten.click();
  await expect(bus218Ten).toHaveAttribute("aria-pressed", "true");
  await expect(bus500Ten).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("0 min · always")).toHaveCount(0);

  await expect(
    page.getByRole("button", { name: "Save as favorite" }),
  ).toHaveCount(0);
  await favoritesButton.click();
  const favoritesDialog = page.getByRole("dialog", {
    name: "Favorites",
  });
  await expect(favoritesDialog).toBeVisible();
  await expect(
    favoritesDialog.getByText("No favorites saved yet."),
  ).toBeVisible();
  await expect(
    favoritesDialog.getByText(
      "You can save a new favorite when you reach the Notify Me tab.",
    ),
  ).toBeVisible();
  const favoriteName = favoritesDialog.getByPlaceholder("Favorite name");
  await favoriteName.fill("Home");
  await favoritesDialog.getByRole("button", { name: "Save" }).click();
  await expect(favoritesDialog).toBeHidden();
  await expect(page.getByText('Saved "Home".')).toBeVisible();
  const toast = page.getByRole("status");
  await expect(toast).toHaveCSS("bottom", "80px");
  await expect(toast).not.toHaveCSS(
    "background-color",
    "rgb(23, 32, 27)",
  );
  await expect(toast.locator(".toast-countdown")).toHaveCSS(
    "animation-duration",
    "5s",
  );

  await expect(favoritesButton).toBeVisible();
  await favoritesButton.click();
  await expect(favoritesDialog).toBeVisible();
  await expect(
    favoritesDialog.getByRole("button", {
      name: /Home hsap n\. falhroy · 218 10\/3\/1 · 500 3\/1/,
    }),
  ).toBeVisible();
  await favoritesDialog
    .getByRole("button", { name: "Close favorites" })
    .click();
  await expect(favoritesDialog).toBeHidden();

  await notifyButton.click();
  await expect(
    page.getByRole("region", { name: "Active alert" }),
  ).toBeVisible();
  const activeAlert = page.getByRole("region", {
    name: "Active alert",
  });
  await expect(activeAlert.locator(".pulse-dot")).toBeVisible();
  await expect(page.locator("header .pulse-dot")).toHaveCount(0);
  await expect(
    activeAlert.getByText("hsap n. falhroy", { exact: true }),
  ).toHaveCount(0);
  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeEnabled();
  await cancelButton.hover();
  await expect(cancelButton).toHaveCSS(
    "border-color",
    "rgb(23, 32, 27)",
  );
  await cancelButton.click();
  await expect(
    page.getByRole("region", { name: "Active alert" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Notify", exact: true }),
  ).toBeEnabled();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem(
          "athens-bus-ticker:v3",
        );
        if (!raw) return null;
        const state = JSON.parse(raw);
        return {
          version: state.version,
          favoriteLineAlerts: state.favorites[0]?.lineAlerts,
        };
      }),
    )
    .toEqual({
      version: 3,
      favoriteLineAlerts: [
        {
          lineId: "218",
          optionalThresholds: [10, 3, 1],
        },
        {
          lineId: "500",
          optionalThresholds: [3, 1],
        },
      ],
    });
});

test("keeps automatic location failures quiet", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(
          _success: PositionCallback,
          error?: PositionErrorCallback,
        ) {
          error?.({
            code: 2,
            message: "Position unavailable",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      },
    });
  });
  await mockStopData(page);
  await page.goto("/");
  await page.clock.fastForward(40_000);

  await expect(
    page.getByText(/Your location is unavailable/),
  ).toHaveCount(0);

  await page
    .getByRole("button", {
      name: "Refresh and center on your location",
    })
    .click();
  await expect(
    page.getByText(/Your location is unavailable/),
  ).toBeVisible();
});

test("keeps other buses active when one bus arrives", async ({ page }) => {
  let arrivalRequestCount = 0;
  await page.clock.install();
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "granted";
        static requestPermission = async () => "granted";
      },
    });
    window.localStorage.setItem(
      "athens-bus-ticker:v3",
      JSON.stringify({
        version: 3,
        selectedStop: {
          code: "400075",
          name: "HSAP N. FALHROY",
        },
        lineAlerts: [
          {
            lineId: "218",
            optionalThresholds: [10, 5, 3, 1],
          },
          {
            lineId: "500",
            optionalThresholds: [10, 5, 3, 1],
          },
        ],
        favorites: [],
        activeAlarm: {
          id: "alarm-1",
          stopCode: "400075",
          stopName: "HSAP N. FALHROY",
          lineAlerts: [
            {
              lineId: "218",
              optionalThresholds: [10, 5, 3, 1],
              firedThresholds: [10, 5, 3, 1],
              predictedZeroAt: null,
              lastObservedMinutes: 1,
              completedAt: null,
            },
            {
              lineId: "500",
              optionalThresholds: [10, 5, 3, 1],
              firedThresholds: [10, 5, 3, 1],
              predictedZeroAt: null,
              lastObservedMinutes: 1,
              completedAt: null,
            },
          ],
          armedAt: new Date(Date.now() - 60_000).toISOString(),
          completedAt: null,
        },
      }),
    );
  });
  await mockStopData(page);
  await page.route("**/api/stops/400075/arrivals", async (route) => {
    arrivalRequestCount += 1;
    await route.fulfill({
      json: {
        arrivals: [
          { routeCode: "2810", vehicleId: "218-a", minutes: 0 },
          {
            routeCode: "5000",
            vehicleId: "500-a",
            minutes: arrivalRequestCount === 1 ? 4 : 0,
          },
        ],
        observedAt: new Date().toISOString(),
      },
    });
  });

  await page.goto("/");
  const activeAlert = page.getByRole("region", { name: "Active alert" });
  await expect(activeAlert).toBeVisible();
  await expect(activeAlert.getByText("ARRIVED")).toHaveCount(1);
  await expect(
    activeAlert.getByText("4 min", { exact: true }),
  ).toHaveCount(1);
  await expect(
    activeAlert.getByText("peiraias - kifisia", { exact: true }),
  ).toHaveCount(1);
  const activeBus500 = activeAlert.locator(
    '[data-alert-line="500"]',
  );
  const activeBadgeBox = await activeBus500
    .locator(".arrival-line-selected")
    .boundingBox();
  const activeDescriptionBox = await activeBus500
    .getByText("peiraias - kifisia", { exact: true })
    .boundingBox();
  const activeTimeBox = await activeBus500
    .getByText("10 min", { exact: true })
    .boundingBox();
  expect(activeBadgeBox).not.toBeNull();
  expect(activeDescriptionBox).not.toBeNull();
  expect(activeTimeBox).not.toBeNull();
  expect(activeDescriptionBox!.y).toBeGreaterThan(
    activeBadgeBox!.y + activeBadgeBox!.height,
  );
  expect(Math.abs(activeTimeBox!.x - activeBadgeBox!.x)).toBeLessThan(
    2,
  );
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

  await page.clock.fastForward(20_000);
  const completedAlert = page.getByRole("region", {
    name: "Alert complete",
  });
  await expect(completedAlert).toBeVisible();
  await expect(completedAlert.getByText("ARRIVED")).toHaveCount(2);
  await expect(
    completedAlert.getByRole("button", { name: "Restart" }),
  ).toBeVisible();
  expect(arrivalRequestCount).toBeGreaterThanOrEqual(2);
});
