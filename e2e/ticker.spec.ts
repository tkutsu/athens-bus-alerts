import { expect, test, type Page } from "@playwright/test";

const STOP = {
  code: "400075",
  name: "HSAP N. FALHROY",
  street: null,
  latitude: 37.9445913,
  longitude: 23.6671421,
  distanceMeters: 0,
};

interface MockArrival {
  routeCode: string;
  vehicleId: string;
  minutes: number;
}

async function mockStopData(
  page: Page,
  arrivalSnapshots:
    | MockArrival[]
    | ((requestCount: number) => MockArrival[]) = [
    { routeCode: "2810", vehicleId: "218-a", minutes: 4 },
    { routeCode: "2810", vehicleId: "218-b", minutes: 12 },
    { routeCode: "2810", vehicleId: "218-c", minutes: 23 },
    { routeCode: "5000", vehicleId: "500-a", minutes: 6 },
    { routeCode: "5000", vehicleId: "500-b", minutes: 19 },
  ],
  observedAtStepMs = 0,
) {
  let arrivalRequestCount = 0;
  const firstObservedAt = Date.now();
  await page.route("**/data/stops.json", async (route) => {
    await route.fulfill({
      json: {
        generatedAt: "2026-08-07T09:56:48.228Z",
        source: "test",
        stops: [STOP],
      },
    });
  });
  await page.route("**/api/stops/400075", async (route) => {
    await route.fulfill({
      json: {
        stop: STOP,
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
          { lineId: "218", description: "PEIRAIAS - ST. DAFNIS" },
          { lineId: "500", description: "PEIRAIAS - KIFISIA" },
        ],
      },
    });
  });
  await page.route("**/api/stops/400075/arrivals", async (route) => {
    arrivalRequestCount += 1;
    const arrivals =
      typeof arrivalSnapshots === "function"
        ? arrivalSnapshots(arrivalRequestCount)
        : arrivalSnapshots;
    await route.fulfill({
      json: {
        arrivals,
        observedAt: new Date(
          firstObservedAt + (arrivalRequestCount - 1) * observedAtStepMs,
        ).toISOString(),
      },
    });
  });
  return { arrivalRequestCount: () => arrivalRequestCount };
}

async function installNotificationMock(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "granted";
        static requestPermission = async () => "granted";
      },
    });
  });
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: STOP.latitude,
    longitude: STOP.longitude,
  });
});

test("keeps stop name search available without location", async ({
  context,
  page,
}) => {
  await context.clearPermissions();
  await mockStopData(page);
  await page.goto("/");

  const picker = page.getByRole("combobox", {
    name: "Search and choose a stop",
  });
  const option = page.getByRole("option", { name: /hsap n\. falhroy/i });

  await expect(picker).toBeVisible();
  await picker.fill("hsap");
  await expect(option).toBeVisible();
  await expect(option.locator(".font-mono")).toHaveCount(0);
  await expect(page.getByText("Showing 1 of 1.", { exact: true })).toBeVisible();
});

test("centers a borderless empty state without timeline connectors", async ({
  page,
}) => {
  await mockStopData(page, []);
  await page.goto("/");

  await page
    .getByRole("combobox", { name: "Search and choose a stop" })
    .click();
  await page.getByRole("option", { name: /hsap n\. falhroy/i }).click();

  const arrivals = page.getByLabel("Bus arrivals");
  const emptyState = page.getByText("no bus found :(", { exact: true });
  const stopTab = page.getByRole("button", {
    name: /hsap n\. falhroy.*change/i,
  });

  await expect(emptyState).toBeVisible();
  await expect(page.locator(".arrival-timeline-rail")).toHaveCount(0);
  await expect(emptyState).toHaveCSS("border-top-width", "0px");
  await expect(emptyState).toHaveCSS("border-bottom-width", "0px");
  await expect
    .poll(() =>
      stopTab.evaluate(
        (element) => getComputedStyle(element, "::after").display,
      ),
    )
    .toBe("none");

  const arrivalsBox = await arrivals.boundingBox();
  const emptyBox = await emptyState.boundingBox();
  expect(arrivalsBox).not.toBeNull();
  expect(emptyBox).not.toBeNull();
  expect(
    Math.abs(
      emptyBox!.x +
        emptyBox!.width / 2 -
        (arrivalsBox!.x + arrivalsBox!.width / 2),
    ),
  ).toBeLessThan(1);
  expect(
    Math.abs(
      emptyBox!.y +
        emptyBox!.height / 2 -
        (arrivalsBox!.y + arrivalsBox!.height / 2),
    ),
  ).toBeLessThan(1);
});

test("fills the picker viewport and keeps search results above the map", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStopData(page);
  await page.goto("/");

  const map = page.getByLabel("Map of OASA bus stops");
  const picker = page.getByRole("combobox", {
    name: "Search and choose a stop",
  });
  const option = page.getByRole("option", { name: /hsap n\. falhroy/i });

  await expect(map).toBeVisible();
  await expect(picker).toBeVisible();
  await expect
    .poll(async () => (await map.boundingBox())?.height ?? 0)
    .toBeGreaterThan(500);

  await picker.fill("hsap");
  await expect(option).toBeVisible();

  const assertResultsOverlayMap = async () => {
    const layout = await picker.evaluate((element) => {
      const shell = element.closest(".stop-picker-shell");
      const mapElement = shell?.querySelector<HTMLElement>(
        '[aria-label="Map of OASA bus stops"]',
      );
      const list = shell?.querySelector<HTMLElement>('[role="listbox"]');
      if (!shell || !mapElement || !list) return null;

      const mapBox = mapElement.getBoundingClientRect();
      const pickerBox = element.getBoundingClientRect();
      const listBox = list.getBoundingClientRect();
      return {
        focusStyles: {
          dividerColor: getComputedStyle(element).borderTopColor,
          outlineStyle: getComputedStyle(element).outlineStyle,
          shellBorderColor: getComputedStyle(shell).borderTopColor,
        },
        listBox: {
          height: listBox.height,
          y: listBox.y,
        },
        mapBox: {
          height: mapBox.height,
          y: mapBox.y,
        },
        pickerBox: {
          y: pickerBox.y,
        },
      };
    });
    expect(layout).not.toBeNull();
    expect(
      Math.abs(
        layout!.mapBox.y + layout!.mapBox.height - layout!.pickerBox.y,
      ),
    ).toBeLessThan(1);
    expect(layout!.focusStyles.outlineStyle).toBe("none");
    expect(layout!.focusStyles.dividerColor).not.toBe(
      layout!.focusStyles.shellBorderColor,
    );
    expect(layout!.listBox.y + layout!.listBox.height).toBeLessThanOrEqual(
      layout!.pickerBox.y,
    );
    expect(layout!.listBox.y).toBeGreaterThanOrEqual(layout!.mapBox.y);
    expect(
      await option.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return hit !== null && element.contains(hit);
      }),
    ).toBe(true);
  };

  await assertResultsOverlayMap();
  await option.click();
  await expect(page.getByLabel("Bus arrivals")).toBeVisible();
  await expect(map).toBeHidden();
  await expect(picker).toBeHidden();

  await page
    .getByRole("button", { name: /hsap n\. falhroy.*change/i })
    .click();
  await expect(map).toBeVisible();
  await expect(picker).toBeVisible();
  await expect
    .poll(async () => (await map.boundingBox())?.height ?? 0)
    .toBeGreaterThan(400);

  await picker.fill("hsap");
  await expect(option).toBeVisible();
  await assertResultsOverlayMap();
  await option.click();
  await expect(page.getByLabel("Bus arrivals")).toBeVisible();

  expect(
    await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    })),
  ).toEqual({ documentHeight: 844, viewportHeight: 844 });
});

test("uses one progressive timeline with independent multi-line toggles", async ({
  page,
}) => {
  await installNotificationMock(page);
  const requests = await mockStopData(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Athens Bus Tracker" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Athens Bus Tracker");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Notify" })).toHaveCount(0);
  await expect(page.getByLabel("Map of OASA bus stops")).toBeVisible();

  // Unselected map stops use the original blue center and white border.
  const mapStopMarker = page.locator(
    ".leaflet-overlay-pane path.leaflet-interactive",
  );
  await expect(mapStopMarker).toHaveCount(1);
  await expect(mapStopMarker).toHaveAttribute("stroke", "#ffffff");
  await expect(mapStopMarker).toHaveAttribute("stroke-opacity", "1");
  await expect(mapStopMarker).toHaveAttribute("fill", "#2563eb");
  await expect(mapStopMarker).toHaveAttribute("fill-opacity", "0.95");

  const stopPicker = page.getByRole("combobox", {
    name: "Search and choose a stop",
  });
  await stopPicker.click();
  await page.getByRole("option", { name: /hsap n\. falhroy/i }).click();

  await expect(page.getByLabel("Map of OASA bus stops")).toBeHidden();
  await expect(page.getByLabel("Bus arrivals")).toBeVisible();
  await expect(
    page.getByText("Tap a bus to track its line.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("15+", { exact: true })).toHaveCount(0);
  await expect(page.locator(".arrival-timeline-bus-icon")).toHaveCount(10);
  // Every icon/tag pair receives a varied schedule that ends with the line draw.
  const entranceRows = page.locator(".arrival-timeline-row");
  const entranceTimings = await entranceRows.evaluateAll((rows) =>
    rows.map((row) => {
      const style = getComputedStyle(row);
      return {
        delay: Number.parseFloat(
          style.getPropertyValue("--arrival-enter-delay"),
        ),
        iconDuration: Number.parseFloat(
          style.getPropertyValue("--arrival-icon-duration"),
        ),
        overshoot: Number.parseFloat(
          style.getPropertyValue("--arrival-pop-scale"),
        ),
        tagDuration: Number.parseFloat(
          style.getPropertyValue("--arrival-tag-duration"),
        ),
      };
    }),
  );
  expect(new Set(entranceTimings.map((timing) => timing.delay)).size).toBeGreaterThan(
    1,
  );
  expect(
    new Set(entranceTimings.map((timing) => timing.iconDuration)).size,
  ).toBeGreaterThan(1);
  for (const timing of entranceTimings) {
    expect(timing.delay).toBeGreaterThanOrEqual(280);
    expect(timing.delay + timing.iconDuration).toBeLessThanOrEqual(860);
    expect(timing.delay + timing.tagDuration).toBeLessThanOrEqual(860);
    expect(timing.overshoot).toBeGreaterThanOrEqual(1.22);
  }
  await expect(entranceRows.first().locator(".arrival-timeline-bus-marker")).toHaveCSS(
    "animation-name",
    "bus-pop-enter",
  );
  await expect(entranceRows.first().locator(".arrival-bus")).toHaveCSS(
    "animation-name",
    "arrival-tag-enter",
  );
  const endpointGroup = page
    .getByRole("button", {
      name: /Enable notifications for line 218, 23 minutes away/,
    })
    .locator("xpath=../..");
  await expect(endpointGroup.locator(".arrival-bus")).toHaveCount(2);
  await expect(endpointGroup.locator(".arrival-timeline-bus-marker")).toHaveCount(
    2,
  );
  await expect(
    endpointGroup
      .locator(".arrival-timeline-bus-marker")
      .first()
      .locator(".arrival-timeline-marker-face-disabled"),
  ).toHaveCSS("background-color", "rgb(183, 187, 185)");
  await expect(endpointGroup).toHaveCSS(
    "--timeline-position",
    "100%",
  );
  await expect(page.locator(".arrival-timeline-rail")).toHaveCSS(
    "background-color",
    "rgb(229, 86, 47)",
  );
  // The rail draws from the selected stop toward the cutoff after map mode.
  await expect(page.locator(".arrival-timeline-rail")).toHaveCSS(
    "animation-name",
    "transit-line-enter",
  );
  await expect(page.locator(".arrival-timeline-rail")).toHaveCSS(
    "animation-duration",
    "0.48s",
  );
  await expect(page.locator(".arrival-timeline-rail")).toHaveCSS(
    "animation-delay",
    "0.38s",
  );
  const stopMarker = page.locator(".selected-stop-marker");
  await expect(stopMarker).toBeVisible();
  const nearBusBox = await page
    .getByRole("button", {
      name: /Enable notifications for line 218, 4 minutes away/,
    })
    .boundingBox();
  const farBusBox = await page
    .getByRole("button", {
      name: /Enable notifications for line 218, 12 minutes away/,
    })
    .boundingBox();
  expect(nearBusBox).not.toBeNull();
  expect(farBusBox).not.toBeNull();
  expect(nearBusBox!.y).toBeLessThan(farBusBox!.y);
  await expect(page.getByText(/Refresh in/i)).toHaveCount(0);
  await expect(page.getByRole("timer")).toHaveCount(0);
  // Geometry assertions use the fully drawn rail rather than an intermediate scale.
  await page.locator(".arrival-timeline-rail").evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const railBox = await page.locator(".arrival-timeline-rail").boundingBox();
  expect(railBox).not.toBeNull();
  const endpointGroupBox = await endpointGroup.boundingBox();
  expect(endpointGroupBox).not.toBeNull();
  expect(
    Math.abs(
      endpointGroupBox!.y + endpointGroupBox!.height / 2 -
        (railBox!.y + railBox!.height),
    ),
  ).toBeLessThan(1);
  const stopMarkerBox = await stopMarker.boundingBox();
  expect(stopMarkerBox).not.toBeNull();
  expect(
    Math.abs(
      stopMarkerBox!.x + stopMarkerBox!.width / 2 -
        (railBox!.x + railBox!.width / 2),
    ),
  ).toBeLessThan(0.5);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));

  const enable218 = page.getByRole("button", {
    name: /Enable notifications for line 218/,
  });
  const enable500 = page.getByRole("button", {
    name: /Enable notifications for line 500/,
  });
  await expect(enable218).toHaveCount(3);
  await expect(enable500).toHaveCount(2);

  const enable218Marker = page.getByRole("button", {
    name: /Enable tracking for line 218, 23 minutes away/,
  });
  await expect(enable218Marker).toHaveAttribute("aria-pressed", "false");
  const endpointMarkerBeforeSelection = await enable218Marker.boundingBox();
  expect(endpointMarkerBeforeSelection).not.toBeNull();
  await enable218Marker.click();
  await expect(
    page.getByText("Tap a bus to track its line.", { exact: true }),
  ).toHaveCount(0);
  const disable218 = page.getByRole("button", {
    name: /Disable notifications for line 218/,
  });
  await expect(disable218).toHaveCount(3);
  await expect(disable218.first()).toHaveAttribute("aria-pressed", "true");
  const selectedBusMarker = disable218
    .first()
    .locator("xpath=..")
    .locator(".arrival-timeline-bus-marker");
  await expect(
    selectedBusMarker.locator(".arrival-timeline-marker-face-disabled"),
  ).toHaveCSS(
    "background-color",
    "rgb(183, 187, 185)",
  );
  // Selection rotates the orange enabled face into view.
  const selectionFlip = await selectedBusMarker.evaluate((element) => {
    const flipper = element.querySelector<HTMLElement>(
      ".arrival-timeline-marker-flipper",
    );
    const enabledFace = element.querySelector<HTMLElement>(
      ".arrival-timeline-marker-face-enabled",
    );
    if (!flipper || !enabledFace) return null;
    const style = getComputedStyle(flipper);
    return {
      backgroundColor: getComputedStyle(enabledFace).backgroundColor,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(selectionFlip).not.toBeNull();
  expect(selectionFlip!.transitionDuration).toBe("0.72s");
  expect(selectionFlip!.backgroundColor).toBe("rgb(229, 86, 47)");
  await expect
    .poll(() =>
      selectedBusMarker
        .locator(".arrival-timeline-marker-flipper")
        .evaluate(
          (element) => new DOMMatrix(getComputedStyle(element).transform).m11,
        ),
    )
    .toBeCloseTo(-1, 5);
  const selectedEndpointRow = page
    .getByRole("button", {
      name: /Disable notifications for line 218, 23 minutes away/,
    })
    .locator("xpath=..");
  const unselectedEndpointRow = page
    .getByRole("button", {
      name: /Enable notifications for line 500, 19 minutes away/,
    })
    .locator("xpath=..");
  const selectedEndpointMarkerBox = await selectedEndpointRow
    .locator(".arrival-timeline-bus-marker")
    .boundingBox();
  const selectedEndpointTagBox = await selectedEndpointRow
    .locator(".arrival-bus")
    .boundingBox();
  const unselectedEndpointMarkerBox = await unselectedEndpointRow
    .locator(".arrival-timeline-bus-marker")
    .boundingBox();
  expect(selectedEndpointMarkerBox).not.toBeNull();
  expect(selectedEndpointTagBox).not.toBeNull();
  expect(unselectedEndpointMarkerBox).not.toBeNull();
  expect(selectedEndpointMarkerBox!.y).toBeGreaterThan(
    unselectedEndpointMarkerBox!.y,
  );
  expect(selectedEndpointTagBox!.x).toBeGreaterThan(
    selectedEndpointMarkerBox!.x + selectedEndpointMarkerBox!.width,
  );
  expect(
    Math.abs(
      selectedEndpointMarkerBox!.y - endpointMarkerBeforeSelection!.y,
    ),
  ).toBeLessThan(5);

  const endpointMarker = selectedEndpointRow.locator(
    ".arrival-timeline-bus-marker",
  );
  const endpointMarkerFace = endpointMarker.locator(
    ".arrival-timeline-marker-face-enabled",
  );
  const endpointTag = selectedEndpointRow.locator(".arrival-bus");
  // Both bus hit targets share the same restrained hover elevation.
  await page.getByRole("heading", { name: "Athens Bus Tracker" }).hover();
  const defaultMarkerShadow = await endpointMarkerFace.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  const defaultTagShadow = await endpointTag.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  await endpointMarker.hover();
  await expect
    .poll(() =>
      endpointMarkerFace.evaluate(
        (element) => getComputedStyle(element).boxShadow,
      ),
    )
    .not.toBe(defaultMarkerShadow);
  await expect
    .poll(() =>
      endpointTag.evaluate((element) => getComputedStyle(element).boxShadow),
    )
    .not.toBe(defaultTagShadow);
  await expect(endpointMarkerFace).toHaveCSS(
    "box-shadow",
    "rgba(23, 32, 27, 0.22) 0px 2px 5px 0px",
  );
  await expect(endpointTag).toHaveCSS(
    "box-shadow",
    "rgba(23, 32, 27, 0.12) 0px 3px 8px 0px",
  );
  await page.getByRole("heading", { name: "Athens Bus Tracker" }).hover();
  await endpointTag.hover();
  await expect
    .poll(() =>
      endpointMarkerFace.evaluate(
        (element) => getComputedStyle(element).boxShadow,
      ),
    )
    .not.toBe(defaultMarkerShadow);
  await expect
    .poll(() =>
      endpointTag.evaluate((element) => getComputedStyle(element).boxShadow),
    )
    .not.toBe(defaultTagShadow);
  await expect(endpointTag).toHaveCSS("border-color", "rgb(229, 86, 47)");
  await expect(endpointTag).toHaveCSS("border-width", "1px");
  const markerBox = await disable218
    .first()
    .locator("xpath=..")
    .locator(".arrival-timeline-bus-marker")
    .boundingBox();
  expect(markerBox).not.toBeNull();
  expect(markerBox!.width).toBeGreaterThanOrEqual(32);
  expect(markerBox!.width).toBeCloseTo(markerBox!.height, 1);
  expect(
    Math.abs(
      markerBox!.x + markerBox!.width / 2 -
        (railBox!.x + railBox!.width / 2),
    ),
  ).toBeLessThan(1);
  await expect(disable218.first().locator("xpath=../..")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await expect(enable500.first()).toHaveCSS("opacity", "1");
  await expect(enable500.first()).toHaveCSS("border-bottom-width", "1px");
  await expect(enable500.first()).toHaveCSS("border-bottom-style", "solid");
  expect(requests.arrivalRequestCount()).toBe(1);

  await enable500.first().click();
  const disable500 = page.getByRole("button", {
    name: /Disable notifications for line 500/,
  });
  await expect(disable500).toHaveCount(2);
  await expect(disable218).toHaveCount(3);
  expect(requests.arrivalRequestCount()).toBe(1);

  await disable218.first().click();
  await expect(
    page.getByRole("button", { name: /Enable notifications for line 218/ }),
  ).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: /Enable tracking for line 218/ })
        .first()
        .locator(".arrival-timeline-marker-flipper")
        .evaluate(
          (element) => new DOMMatrix(getComputedStyle(element).transform).m11,
        ),
    )
    .toBeCloseTo(1, 5);
  await expect(disable500).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Enable notifications for line 218/ }).last(),
  ).toHaveCSS("opacity", "1");

  await page
    .getByRole("button", { name: /Enable notifications for line 218/ })
    .last()
    .click();
  await expect(disable218).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: /^(10|5|3|1) min$/ }),
  ).toHaveCount(0);

  const stopRow = page.getByRole("button", {
    name: /hsap n\. falhroy.*change/i,
  });
  const stopDisclosure = page.locator(".selected-stop-disclosure");
  const stopPanel = stopDisclosure.locator(".selected-stop-panel");
  await expect(
    stopDisclosure.getByLabel("Map of OASA bus stops"),
  ).toHaveCount(1);
  await expect(stopPanel).toHaveCSS("grid-template-rows", "0px");
  await expect(stopPanel).toHaveCSS(
    "transition-duration",
    "0.28s, 0.18s, 0s",
  );
  await stopRow.click();
  await expect(page.getByLabel("Map of OASA bus stops")).toBeVisible();
  await expect
    .poll(async () => (await stopPanel.boundingBox())?.height ?? 0)
    .toBeGreaterThan(200);
  // Selection swaps the blue center for an orange one inside the white border.
  await expect(mapStopMarker).toHaveAttribute("stroke", "#ffffff");
  await expect(mapStopMarker).toHaveAttribute("stroke-opacity", "1");
  await expect(mapStopMarker).toHaveAttribute("fill", "#e5562f");
  await expect(mapStopMarker).toHaveAttribute("fill-opacity", "0.95");
  await expect(page.getByLabel("Bus arrivals")).toBeHidden();
  await page
    .getByRole("button", { name: /hsap n\. falhroy.*track/i })
    .click();
  // The connector and rail share one keyframe with consecutive start times.
  const connectorAnimation = await page
    .locator(".selected-stop-row")
    .evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return {
        delay: style.animationDelay,
        duration: style.animationDuration,
        name: style.animationName,
      };
    });
  expect(connectorAnimation).toEqual({
    delay: "0.28s",
    duration: "0.1s",
    name: "transit-line-enter",
  });
  const revealedRail = page.locator(".arrival-timeline-rail");
  await expect(page.locator(".arrival-timeline-section-entering")).toBeVisible();
  const railAnimation = await revealedRail.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation || !(animation.effect instanceof KeyframeEffect)) return null;
    const timing = animation.effect.getTiming();
    return {
      delay: timing.delay,
      duration: timing.duration,
      transforms: animation.effect
        .getKeyframes()
        .map((keyframe) => keyframe.transform),
    };
  });
  expect(railAnimation).toEqual({
    delay: 380,
    duration: 480,
    transforms: ["scaleY(0)", "scaleY(1)"],
  });
  await expect(page.getByLabel("Map of OASA bus stops")).toBeHidden();
  await expect
    .poll(async () => (await stopPanel.boundingBox())?.height ?? -1)
    .toBe(0);
  await expect(page.getByLabel("Bus arrivals")).toBeVisible();
  await expect(page.locator(".arrival-timeline-rail")).toHaveCSS(
    "animation-name",
    "transit-line-enter",
  );

  await page.reload();
  await expect(page.getByLabel("Bus arrivals")).toBeVisible();
  expect(requests.arrivalRequestCount()).toBe(1);
});

test("saves a multi-line favorite with v4 storage", async ({ page }) => {
  await installNotificationMock(page);
  await mockStopData(page);
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Search and choose a stop" })
    .click();
  await page.getByRole("option", { name: /hsap n\. falhroy/i }).click();
  await page
    .getByRole("button", { name: /Enable notifications for line 218/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Enable notifications for line 500/ })
    .first()
    .click();

  await page
    .locator("header")
    .getByRole("button", { name: "Favorites" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Favorites" });
  await dialog.getByPlaceholder("Favorite name").fill("Home");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("athens-bus-ticker:v4");
        if (!raw) return null;
        const state = JSON.parse(raw);
        return {
          version: state.version,
          lineIds: state.favorites[0]?.lineIds,
          subscriptions: state.subscriptions.map(
            (item: { lineId: string }) => item.lineId,
          ),
        };
      }),
    )
    .toEqual({
      version: 4,
      lineIds: ["218", "500"],
      subscriptions: ["218", "500"],
    });
});

test("promotes the next same-code bus after due-now", async ({ page }) => {
  await installNotificationMock(page);
  await mockStopData(page, [
    { routeCode: "2810", vehicleId: "218-first", minutes: 0 },
    { routeCode: "2810", vehicleId: "218-next", minutes: 6 },
  ]);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "athens-bus-ticker:v4",
      JSON.stringify({
        version: 4,
        selectedStop: { code: "400075", name: "HSAP N. FALHROY" },
        subscriptions: [
          {
            lineId: "218",
            trackedVehicleKey: null,
            firedOneMinute: false,
            predictedZeroAt: null,
            lastObservedMinutes: null,
            recentVehicles: [],
          },
        ],
        favorites: [],
      }),
    );
  });
  await page.goto("/");

  const urgent = page.getByRole("alert").filter({ hasText: /due now/i });
  await expect(urgent).toContainText("218");
  await expect(
    page.getByRole("button", { name: /Disable notifications for line 218/ }),
  ).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("athens-bus-ticker:v4") ?? "null",
        );
        const subscription = state?.subscriptions?.[0];
        return subscription
          ? {
              tracked: subscription.trackedVehicleKey,
              recent: subscription.recentVehicles.map(
                (item: { key: string }) => item.key,
              ),
            }
          : null;
      }),
    )
    .toEqual({
      tracked: "2810:218-next",
      recent: ["2810:218-first"],
    });
});

test("flips a bus when a fresh snapshot moves it backward", async ({
  page,
}) => {
  await page.clock.install();
  await installNotificationMock(page);
  const requests = await mockStopData(
    page,
    (requestCount) => [
      {
        routeCode: "2810",
        vehicleId: "218-a",
        minutes: requestCount === 1 ? 4 : 7,
      },
    ],
    30_000,
  );
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Search and choose a stop" })
    .click();
  await page.getByRole("option", { name: /hsap n\. falhroy/i }).click();
  await page
    .getByRole("button", { name: /Enable notifications for line 218/ })
    .click();

  // A retained data attribute proves the tag was not remounted for the icon flip.
  await page
    .getByRole("button", { name: /Disable notifications for line 218/ })
    .evaluate((element) => {
      element.dataset.correctionIdentity = "retained";
    });

  await page.clock.fastForward(60_000);
  await expect.poll(requests.arrivalRequestCount).toBeGreaterThanOrEqual(2);

  const correctedRow = page
    .getByRole("button", { name: /Disable notifications for line 218/ })
    .locator("xpath=..");
  await expect(
    page.getByRole("button", { name: /Disable notifications for line 218/ }),
  ).toHaveAttribute("data-correction-identity", "retained");
  const correctedMarker = correctedRow.locator(
    ".arrival-timeline-bus-marker",
  );
  const correctedGroup = correctedRow.locator("xpath=..");
  await expect(correctedRow).toHaveClass(/arrival-timeline-row-flip/);
  await expect(correctedMarker).toHaveCSS(
    "animation-name",
    "bus-jump-flip",
  );
  await expect(correctedGroup).toHaveCSS(
    "animation-name",
    "bus-group-backtrack",
  );
  expect(
    await correctedGroup.evaluate((element) =>
      Number.parseFloat(
        getComputedStyle(element).getPropertyValue("--backtrack-offset"),
      ),
    ),
  ).toBeLessThan(0);
  await expect(correctedMarker).toHaveCSS("animation-duration", "0.96s");
  await expect(correctedGroup).toHaveCSS("animation-duration", "0.96s");
  await expect(correctedMarker).toHaveCSS(
    "animation-timing-function",
    "ease-in-out",
  );
  await expect(correctedGroup).toHaveCSS(
    "animation-timing-function",
    "ease-in-out",
  );
});

test("accelerates and brakes for a forward ETA correction", async ({
  page,
}) => {
  await page.clock.install();
  await installNotificationMock(page);
  const requests = await mockStopData(
    page,
    (requestCount) => [
      {
        routeCode: "2810",
        vehicleId: "218-a",
        minutes: requestCount === 1 ? 4 : 2,
      },
    ],
    30_000,
  );
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Search and choose a stop" })
    .click();
  await page.getByRole("option", { name: /hsap n\. falhroy/i }).click();
  await page
    .getByRole("button", { name: /Enable notifications for line 218/ })
    .click();

  await page.clock.fastForward(60_000);
  await expect.poll(requests.arrivalRequestCount).toBeGreaterThanOrEqual(2);

  const correctedGroup = page
    .getByRole("button", { name: /Disable notifications for line 218/ })
    .locator("xpath=../..");
  await expect(correctedGroup).toHaveClass(/arrival-timeline-group-forward/);
  await expect(correctedGroup).toHaveCSS(
    "transition-timing-function",
    "cubic-bezier(0.5, 0, 0.9, 1)",
  );
});
