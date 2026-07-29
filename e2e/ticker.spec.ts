import { expect, test } from "@playwright/test";

test("reveals each step only after the previous selection", async ({
  context,
  page,
}) => {
  let arrivalRequestCount = 0;
  let catalogueRequestCount = 0;
  const discoveryApiRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\/api\/(?:nearby-stops|stops\/(?:map|search))/.test(
        new URL(request.url()).pathname,
      )
    ) {
      discoveryApiRequests.push(request.url());
    }
  });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 37.9445913,
    longitude: 23.6671421,
  });
  await page.route("**/data/stops.json", async (route) => {
    catalogueRequestCount += 1;
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
          {
            code: "060001",
            name: "SYNTAGMA",
            latitude: 37.9753,
            longitude: 23.7357,
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
        ],
        lines: [
          {
            lineId: "218",
            description: "PEIRAIAS - ST. DAFNIS",
          },
        ],
      },
    });
  });
  await page.route("**/api/stops/400075/arrivals", async (route) => {
    arrivalRequestCount += 1;
    await route.fulfill({
      json: {
        arrivals: [
          { routeCode: "2810", vehicleId: "32336", minutes: 4 },
        ],
        observedAt: new Date().toISOString(),
      },
    });
  });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Athens Bus Notifications" }),
  ).toBeVisible();
  await expect(page.getByText("Athens Bus Ticker")).toHaveCount(0);
  await expect(
    page.getByText("Pick stop · Pick bus · Get notified"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Refresh and center on your location",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Map of OASA bus stops")).toBeVisible();
  const stopPicker = page.getByRole("combobox", {
    name: "Search and choose a stop",
  });
  await expect(stopPicker).toBeVisible();
  await expect(page.getByText("Enter stop code instead")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "02 · BUSES" })).toBeHidden();
  await expect(page.getByText("10 min")).toBeHidden();
  await expect(page.getByPlaceholder("New favorite")).toBeHidden();

  const stopToggle = page.getByRole("button", { name: "01 · Bus stop" });
  await stopToggle.click();
  await expect(stopToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Map of OASA bus stops")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: "Refresh and center on your location",
    }),
  ).toBeHidden();
  await stopToggle.click();

  await expect(page.getByText("Your position")).toBeVisible();
  await expect(
    page.locator(".leaflet-marker-icon path").first(),
  ).toHaveAttribute("fill", "#e5562f");
  const mapBox = await page.getByLabel("Map of OASA bus stops").boundingBox();
  const stopSelectBox = await stopPicker.boundingBox();
  expect(mapBox).not.toBeNull();
  expect(stopSelectBox).not.toBeNull();
  expect(mapBox!.y).toBeLessThan(stopSelectBox!.y);

  await stopPicker.click();
  await expect(
    page.getByRole("option", { name: /1\. HSAP N\. FALHROY/ }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "Athens Bus Notifications" })
    .click();
  await expect(page.getByRole("listbox")).toBeHidden();

  await stopPicker.fill("syntagma");
  await expect(
    page.getByRole("option", { name: /SYNTAGMA/ }),
  ).toBeVisible();
  await expect(page.getByRole("listbox")).not.toContainText("#060001");
  await stopPicker.fill("");
  await page
    .getByRole("option", { name: /1\. HSAP N\. FALHROY/ })
    .click();

  await expect(stopToggle).toContainText("HSAP N. FALHROY");
  await expect(stopToggle).not.toContainText("#400075");
  await expect(
    page.getByText("HSAP N. FALHROY", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "218" })).toBeVisible();
  expect(catalogueRequestCount).toBe(1);
  expect(discoveryApiRequests).toEqual([]);
  expect(arrivalRequestCount).toBe(0);
  await expect(page.getByRole("button", { name: "218" })).toHaveClass(
    /time-chip/,
  );
  await expect(page.getByText("10 min")).toBeHidden();

  const busesToggle = page.getByRole("button", { name: "02 · Buses" });
  await busesToggle.click();
  await expect(page.getByRole("button", { name: "218" })).toBeHidden();
  await busesToggle.click();
  await page.getByRole("button", { name: "218" }).click();
  await expect(busesToggle).toContainText("218");

  await expect(page.getByText("10 min")).toBeVisible();
  await expect(page.getByText("0 min · always")).toBeVisible();
  await expect(page.getByPlaceholder("New favorite")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save favorite" }),
  ).toBeHidden();

  const notifyToggle = page.getByRole("button", { name: "03 · Notify" });
  await expect(notifyToggle).toContainText("10/5/3/1/0 min");
  await notifyToggle.click();
  await expect(page.getByText("10 min")).toBeHidden();
  await notifyToggle.click();

  await page.getByPlaceholder("New favorite").fill("Home");
  await expect(
    page.getByRole("button", { name: "Save favorite" }),
  ).toBeVisible();
  await page.getByPlaceholder("New favorite").press("Enter");
  await expect(page.getByText('Saved "Home".')).toBeVisible();
  await expect(page.getByRole("status")).toHaveClass(/fixed/);
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await expect(page.getByRole("status")).toBeHidden();
  const savedFavoriteBox = await page
    .getByRole("button", { name: /Home HSAP N\. FALHROY/ })
    .boundingBox();
  const favoriteFormBox = await page
    .getByPlaceholder("New favorite")
    .boundingBox();
  expect(savedFavoriteBox).not.toBeNull();
  expect(favoriteFormBox).not.toBeNull();
  expect(favoriteFormBox!.y).toBeGreaterThan(savedFavoriteBox!.y);
  const favoriteMenuBox = await page
    .locator("details[data-favorite-menu] summary")
    .boundingBox();
  const draftPencilBox = await page
    .getByRole("button", { name: "Edit new favorite" })
    .boundingBox();
  expect(favoriteMenuBox).not.toBeNull();
  expect(draftPencilBox).not.toBeNull();
  expect(
    Math.abs(
      draftPencilBox!.x +
        draftPencilBox!.width -
        (favoriteMenuBox!.x + favoriteMenuBox!.width),
    ),
  ).toBeLessThan(2);
  await page.getByRole("button", { name: "Edit new favorite" }).click();
  await expect(page.getByPlaceholder("New favorite")).toBeFocused();
  await expect(page.getByPlaceholder("New favorite")).toHaveCSS(
    "outline-style",
    "none",
  );

  await page.getByRole("button", { name: "10 min" }).click();
  const favoriteMenu = page.locator("details[data-favorite-menu]");
  await favoriteMenu.locator("summary").click();
  await favoriteMenu.getByRole("button", { name: "Update" }).click();
  await expect(favoriteMenu).not.toHaveAttribute("open", "");
  await expect(page.getByText('Updated "Home".')).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Home HSAP N\. FALHROY · 218 · 5\/3\/1\/0/ }),
  ).toBeVisible();

  await favoriteMenu.locator("summary").click();
  await expect(favoriteMenu).toHaveAttribute("open", "");
  await page
    .getByRole("heading", { name: "Athens Bus Notifications" })
    .click();
  await expect(favoriteMenu).not.toHaveAttribute("open", "");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.localStorage.getItem("athens-bus-ticker:v2");
        return value ? JSON.parse(value).favorites.length : 0;
      }),
    )
    .toBe(1);
  await page.evaluate(() => {
    const key = "athens-bus-ticker:v2";
    const value = window.localStorage.getItem(key);
    if (!value) throw new Error("Expected persisted app state.");
    const state = JSON.parse(value);
    state.activeAlarm = {
      id: "alarm-layout",
      stopCode: "400075",
      stopName: "HSAP N. FALHROY",
      selectedLineIds: ["218"],
      optionalThresholds: [10, 5, 3, 1],
      firedThresholds: [10, 5, 3, 1],
      predictedZeroAt: null,
      lastObservedLineId: "218",
      lastObservedMinutes: 4,
      armedAt: "2026-07-29T10:00:00.000Z",
      completedAt: null,
    };
    window.localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();

  const activeAlertPanel = page.getByRole("region", {
    name: "Active alert",
  });
  await expect(
    page.getByRole("button", { name: "01 · Bus stop" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "02 · Buses" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "03 · Notify" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    activeAlertPanel.getByRole("heading", { name: "Live arrivals" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live arrivals" }),
  ).toHaveCount(1);
  await expect(activeAlertPanel.getByText(/^Earliest /)).toHaveCount(0);
  await expect(activeAlertPanel.getByText(/Updated/)).toHaveClass(
    /text-right/,
  );

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Replace the currently active alert?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Enable" }).click();
  await expect(activeAlertPanel).toContainText("10/5/3/1/0 min");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.localStorage.getItem("athens-bus-ticker:v2");
        return value ? JSON.parse(value).activeAlarm?.id : null;
      }),
    )
    .toBe("alarm-layout");

  const cancelBox = await page
    .getByRole("button", { name: "Cancel alert" })
    .boundingBox();
  const favoritesBox = await page
    .getByRole("heading", { name: "Favorites" })
    .boundingBox();
  expect(cancelBox).not.toBeNull();
  expect(favoritesBox).not.toBeNull();
  expect(cancelBox!.y).toBeLessThan(favoritesBox!.y);
});

test("keeps selections and can restart after a bus reaches zero", async ({
  context,
  page,
}) => {
  let arrivalRequestCount = 0;
  await context.grantPermissions(["notifications"], {
    origin: "http://127.0.0.1:3100",
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "granted";
        static requestPermission = async () => "granted";
      },
    });
    window.localStorage.setItem(
      "athens-bus-ticker:v2",
      JSON.stringify({
        version: 2,
        selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
        selectedLineIds: ["218"],
        optionalThresholds: [10, 5, 3, 1],
        favorites: [],
        activeAlarm: {
          id: "alarm-1",
          stopCode: "400075",
          stopName: "HSAP N. FALHROY",
          selectedLineIds: ["218"],
          optionalThresholds: [10, 5, 3, 1],
          firedThresholds: [10, 5, 3, 1],
          predictedZeroAt: null,
          lastObservedLineId: "218",
          lastObservedMinutes: 1,
          armedAt: "2026-07-29T10:00:00.000Z",
        },
      }),
    );
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
        ],
        lines: [
          {
            lineId: "218",
            description: "PEIRAIAS - ST. DAFNIS",
          },
        ],
      },
    });
  });
  await page.route("**/api/stops/400075/arrivals", async (route) => {
    arrivalRequestCount += 1;
    await route.fulfill({
      json: {
        arrivals: [
          {
            routeCode: "2810",
            vehicleId: "32336",
            minutes: arrivalRequestCount === 1 ? 0 : 4,
          },
        ],
        observedAt: new Date().toISOString(),
      },
    });
  });

  await page.goto("/");

  const stopToggle = page.getByRole("button", { name: "01 · Bus stop" });
  const busesToggle = page.getByRole("button", { name: "02 · Buses" });
  const notifyToggle = page.getByRole("button", { name: "03 · Notify" });

  await expect(stopToggle).toContainText("HSAP N. FALHROY");
  await expect(busesToggle).toContainText("218");
  await expect(notifyToggle).toContainText("10/5/3/1/0 min");
  await expect(
    page.getByRole("heading", { name: "Live arrivals" }),
  ).toBeHidden();
  const completedAlert = page.getByRole("region", {
    name: "Alert complete",
  });
  await expect(completedAlert).toBeVisible();
  await expect(completedAlert).toContainText("218 arrived");
  await expect(
    completedAlert.getByRole("button", { name: "Restart" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.localStorage.getItem("athens-bus-ticker:v2");
        if (!value) return null;
        const stored = JSON.parse(value);
        return {
          selectedStop: stored.selectedStop,
          selectedLineIds: stored.selectedLineIds,
        };
      }),
    )
    .toEqual({
      selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
      selectedLineIds: ["218"],
    });

  await completedAlert.getByRole("button", { name: "Restart" }).click();
  const restartedAlert = page.getByRole("region", { name: "Active alert" });
  await expect(restartedAlert).toBeVisible();
  await expect(
    restartedAlert.getByRole("heading", { name: "Live arrivals" }),
  ).toBeVisible();
  await expect(restartedAlert).toContainText("4 min");
  expect(arrivalRequestCount).toBe(2);

  await restartedAlert.getByRole("button", { name: "Cancel alert" }).click();
  await expect(restartedAlert).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Live arrivals" }),
  ).toHaveCount(0);
});
